/**
 * `@docket/api` — the Linear Agent session-run sweep.
 *
 * @remarks
 * `routes/ingest-linear-agent.ts` is the first writer of `agent_session_run` — it queues a
 * `status: 'queued'` row synchronously from the webhook handler, but (per that file's own
 * remarks) deliberately never calls {@link driveSession} inline, since the webhook's Cloud Run
 * instance is CPU-throttled to near-zero the instant the HTTP response is sent. This sweep is
 * the other half: it finds sessions with runnable generations, drives each session's turn to
 * completion, and relays whatever new activity landed back to the Linear thread
 * ({@link relayExternalAgentActivity}).
 *
 * This sweep does NOT lease the run rows itself. `claimRunGeneration` is the single claimer of a
 * generation, and it holds the fencing token every generation-owned write is checked against; a
 * second lease taken here would be invisible to that token and would let two workers believe
 * they owned the same generation. The sweep therefore selects candidates optimistically and
 * hands each session to {@link driveSession}, whose claim is the atomic one — two overlapping
 * sweep ticks resolve there, with the loser seeing a `ConflictError` and moving on.
 */
import { and, asc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';

import { agentSessionRun, db } from '@docket/db';

import { driveSession } from '../agent/loop';
import {
  relayExternalAgentActivity,
  sweepExternalAgentRelays,
  type ExternalAgentRelaySweepResult,
} from '../lib/external-agent-relay';

/** A workspace-owned session this tick will try to drive. */
interface Candidate {
  readonly sessionId: string;
  readonly organizationId: string;
}

/**
 * Minutes between `docket-run-linear-agent-sessions` ticks.
 *
 * @remarks
 * Must match that job's schedule in `scripts/scheduler-setup.ts` — the two are not otherwise
 * linked, so keep them in step by hand when either changes.
 */
const SWEEP_CADENCE_MINUTES = 5;

/**
 * Rows considered per sweep tick.
 *
 * @remarks
 * Scaled to {@link SWEEP_CADENCE_MINUTES} off a base of 25/minute so candidates queuing over the
 * wider window don't outpace what one tick clears. Each candidate still runs a full multi-turn
 * agentic loop (LLM calls + tool execution) sequentially, so one invocation's wall-clock time
 * grows with this number; overlapping ticks are harmless regardless (see this file's top-level
 * remarks on the fencing-token claim), and both the Cloud Run request timeout and this job's
 * Cloud Scheduler `--attempt-deadline` were raised alongside this limit for the same reason.
 */
const BATCH_LIMIT = 25 * SWEEP_CADENCE_MINUTES;

/** The outcome of one sweep tick. */
export interface LinearAgentSweepResult {
  /** Candidates this tick actually took on (won the generation claim). */
  readonly claimed: number;
  /** Candidates whose `driveSession` call returned without throwing. */
  readonly succeeded: number;
  /** Candidates whose `driveSession` call threw after being claimed. */
  readonly failed: number;
  /** External links inspected independently of runnable model generations. */
  readonly relay: ExternalAgentRelaySweepResult;
}

/**
 * The `agent_session_run` rows worth trying: queued, or `running` past their recorded lease.
 *
 * @remarks
 * Workspace-owned runs only. A run row carries either an organization or an owning user, never
 * both, and the owner-attributed ones are personal Athena work with no Linear thread to relay to
 * — they are driven by the durable runner instead. Picking them up here would both steal them
 * from that path and leave this sweep with no workspace to drive them in.
 *
 * Unlike sibling sweeps (`event-sync.ts`'s `claimEvent`, `integration-sync.ts`'s `claimLease`),
 * which derive staleness from "processing started more than a fixed window ago", this table
 * stores the lease's own absolute expiry. Eligibility is therefore a direct comparison against
 * `now`: a lease that expired even one second ago is already fair game.
 */
function runnableCondition(now: Date) {
  return and(
    isNotNull(agentSessionRun.organizationId),
    or(
      eq(agentSessionRun.status, 'queued'),
      and(
        eq(agentSessionRun.status, 'running'),
        or(isNull(agentSessionRun.leaseExpiresAt), lt(agentSessionRun.leaseExpiresAt, now)),
      ),
    ),
  );
}

/**
 * Record a terminal failure on a session's still-unclaimed run rows.
 *
 * @remarks
 * Only reached when `claimRunGeneration` refused the session outright, so no worker holds a
 * fencing token for these rows and settling them here cannot race one. Scoped to `queued` rows
 * and to `running` rows whose lease has already lapsed, which is exactly the set this tick was
 * willing to pick up.
 */
async function settleUnclaimableRuns(sessionId: string, message: string): Promise<void> {
  await db
    .update(agentSessionRun)
    .set({ status: 'failed', lastError: message, completedAt: new Date() })
    .where(
      and(
        eq(agentSessionRun.sessionId, sessionId),
        isNull(agentSessionRun.leaseToken),
        or(eq(agentSessionRun.status, 'queued'), eq(agentSessionRun.status, 'running')),
      ),
    );
}

/**
 * Errors that mean another worker got there first, rather than that this run is broken.
 *
 * @remarks
 * Every one of these leaves the generation owned and progressing somewhere else, so the right
 * response is to drop the candidate and look again next tick. Anything else — most importantly
 * "not in a runnable state", raised when the session settled before its queued run was ever
 * driven — is terminal for this run and must be recorded, or the row stays queued forever and
 * the sweep retries it every tick (five minutes, see `scripts/scheduler-setup.ts`) for the life
 * of the deployment.
 */
const RACE_MESSAGES =
  /generation is already running|generation changed during|concurrent run limit/i;

/**
 * Drive one candidate's session forward and relay whatever activity landed.
 *
 * @remarks
 * On the success path `driveSession` claims the generation, settles the run row, and releases
 * the lease, so this function deliberately does not touch `agent_session_run` — writing a status
 * there would race the very worker holding the fencing token. The one exception is a terminal
 * failure raised *before* any claim succeeded, where no token exists and nobody else will ever
 * settle the row; {@link settleUnclaimableRuns} handles exactly that case.
 */
async function processCandidate(
  candidate: Candidate,
): Promise<'succeeded' | 'failed' | 'unclaimed'> {
  let outcome: 'succeeded' | 'failed';
  try {
    await driveSession(candidate.organizationId, candidate.sessionId);
    outcome = 'succeeded';
  } catch (err) {
    if (err instanceof Error && RACE_MESSAGES.test(err.message)) return 'unclaimed';
    const message = err instanceof Error ? err.message : 'agent session run failed';
    await settleUnclaimableRuns(candidate.sessionId, message);
    outcome = 'failed';
  }

  // Relay whatever landed regardless of the drive outcome: a turn that crashed partway through
  // still very likely wrote thought/response/action rows worth mirroring to Linear, and a
  // completed/waiting/failed turn certainly did. Isolated in its own try/catch so a relay
  // failure (e.g. a revoked Linear install) never masks the outcome above; it is simply retried
  // from its own watermark next tick.
  try {
    await relayExternalAgentActivity(candidate.sessionId, new Date());
  } catch (err) {
    console.warn('[linear-agent-sweep] relay failed for session', {
      sessionId: candidate.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return outcome;
}

/**
 * Sweep once: find due `agent_session_run` rows, drive each session, and relay the result.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepLinearAgentSessions(now: Date): Promise<LinearAgentSweepResult> {
  const rows = await db
    .select({
      sessionId: agentSessionRun.sessionId,
      organizationId: agentSessionRun.organizationId,
    })
    .from(agentSessionRun)
    .where(runnableCondition(now))
    .orderBy(asc(agentSessionRun.queuedAt))
    .limit(BATCH_LIMIT);

  // One generation per session per tick: the newest runnable row wins, since driving the session
  // settles whatever generation `claimRunGeneration` picks anyway.
  const bySession = new Map<string, Candidate>();
  for (const row of rows) {
    if (row.organizationId === null || bySession.has(row.sessionId)) continue;
    bySession.set(row.sessionId, {
      sessionId: row.sessionId,
      organizationId: row.organizationId,
    });
  }

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const candidate of bySession.values()) {
    const outcome = await processCandidate(candidate);
    if (outcome === 'unclaimed') continue; // lost the race to a concurrent worker.
    claimed += 1;
    if (outcome === 'succeeded') succeeded += 1;
    else failed += 1;
  }

  const relay = await sweepExternalAgentRelays(now);
  return { claimed, succeeded, failed, relay };
}
