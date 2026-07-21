/**
 * `@docket/api` — the Linear Agent session-run sweep.
 *
 * @remarks
 * `routes/ingest-linear-agent.ts` is the FIRST writer of `agent_session_run` — it queues a
 * `status: 'queued'` row synchronously from the webhook handler, but (per that file's own
 * remarks) deliberately never calls {@link driveSession} inline, since the webhook's Cloud Run
 * instance is CPU-throttled to near-zero the instant the HTTP response is sent. This sweep is
 * the other half: it claims queued (or abandoned) runs on a lease, drives each session's turn to
 * completion, and relays whatever new activity landed back to the Linear thread
 * ({@link relayLinearAgentActivity}).
 *
 * Lease-guarded exactly like the sibling sweeps in `routes/cron.ts` (`integration-sync.ts`'s
 * `claimLease`, `event-sync.ts`'s `claimEvent`): a claim is an atomic conditional `UPDATE`, so
 * two overlapping sweep ticks (or a retried scheduler invocation) can never double-process the
 * same run.
 */
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { agentSessionRun, db } from '@docket/db';

import { driveSession } from '../agent/loop';
import { relayLinearAgentActivity } from '../lib/linear-agent-relay';
import type { SessionRow } from './agent-session-helpers';

/** The selected `agent_session_run` row shape this sweep claims and settles. */
type RunRow = typeof agentSessionRun.$inferSelect;

/**
 * Rows claimed per sweep tick.
 *
 * @remarks
 * No sibling sweep claims `agent_session_run` rows today, so there is no existing precedent to
 * match exactly. 25 sits in the middle of a sane 20-50 range: this sweep is registered at a
 * tight once-a-minute cadence (see `scripts/scheduler-setup.ts`), and each claimed row runs a
 * full multi-turn agentic loop (LLM calls + tool execution) rather than a cheap row update, so a
 * smaller batch keeps one invocation's wall-clock time predictable.
 */
const BATCH_LIMIT = 25;

/**
 * How long a claimed run holds its lease before another sweep tick may reclaim it.
 *
 * @remarks
 * `driveSession` is a full multi-turn agentic loop, not a single cheap request — 10 minutes is
 * comfortably longer than any plausible single run (bounded by `AGENT_MAX_TURNS`) while still
 * reclaiming a genuinely crashed worker well within the hour. Matches the task's suggested
 * "safely longer than a single `driveSession` call could plausibly take" 5–10 minute range, at
 * the generous end since a turn can include slow tool calls (remote MCP connectors).
 */
const LEASE_MS = 10 * 60 * 1000;

/** The outcome of one sweep tick. */
export interface LinearAgentSweepResult {
  /** Runs claimed (won the atomic claim) this tick. */
  readonly claimed: number;
  /** Claimed runs whose `driveSession` call returned without throwing. */
  readonly succeeded: number;
  /** Claimed runs whose `driveSession` call threw. */
  readonly failed: number;
}

/**
 * The `agent_session_run` rows eligible to claim: queued, or `running` past its own recorded
 * lease expiry.
 *
 * @remarks
 * Unlike sibling sweeps (`event-sync.ts`'s `claimEvent`, `integration-sync.ts`'s `claimLease`),
 * which derive staleness from "processing started more than a fixed window ago" (`now -
 * LEASE_STALE_MS`), this table stores the lease's own absolute expiry (`leaseExpiresAt`, set to
 * `now + LEASE_MS` at claim time — see {@link claimRun}). Eligibility is therefore a direct
 * comparison against `now`, NOT `now - LEASE_MS`: a lease that expired even one second ago is
 * already fair game, and re-subtracting the lease window here would wrongly require it to have
 * been expired for a FULL extra `LEASE_MS` before reclaiming it.
 */
function claimableCondition(now: Date) {
  return or(
    eq(agentSessionRun.status, 'queued'),
    and(
      eq(agentSessionRun.status, 'running'),
      or(isNull(agentSessionRun.leaseExpiresAt), lt(agentSessionRun.leaseExpiresAt, now)),
    ),
  );
}

/**
 * Atomically claim one run: flip it to `running`, stamp a fresh lease, and bump `attempt`.
 *
 * @remarks
 * The `WHERE` re-asserts the exact eligibility condition the candidate was selected under, so a
 * concurrent sweep tick that already claimed this row first makes this `UPDATE` affect zero rows
 * — the caller sees `null` and moves on rather than double-processing.
 */
async function claimRun(id: string, now: Date): Promise<RunRow | null> {
  const [claimed] = await db
    .update(agentSessionRun)
    .set({
      status: 'running',
      startedAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempt: sql`${agentSessionRun.attempt} + 1`,
    })
    .where(and(eq(agentSessionRun.id, id), claimableCondition(now)))
    .returning();
  return claimed ?? null;
}

/**
 * Map a settled session's status onto the run's own status vocabulary.
 *
 * @remarks
 * `agent_session_run_status` carries a dedicated `waiting` value distinct from `completed` — a
 * session that settled `awaiting_input`/`awaiting_approval` did NOT fail and did NOT finish; it
 * is genuinely parked pending a human. Collapsing that into `completed` would make the run
 * history lie about why the generation stopped without producing a final answer; collapsing it
 * into `failed` would page/alert on completely ordinary human-in-the-loop behavior. A `canceled`
 * session (an explicit pause/cancel taken mid-run) is passed through as `canceled` for the same
 * reason.
 */
function runStatusFor(sessionStatus: SessionRow['status']): RunRow['status'] {
  switch (sessionStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'awaiting_input':
    case 'awaiting_approval':
    case 'pending':
    case 'running':
      return 'waiting';
  }
}

/**
 * Drive one claimed run's session forward, settle the run row, and relay whatever activity
 * landed — regardless of the drive outcome.
 */
async function processRun(run: RunRow): Promise<'succeeded' | 'failed'> {
  let outcome: 'succeeded' | 'failed';
  try {
    const settled = await driveSession(run.organizationId, run.sessionId);
    await db
      .update(agentSessionRun)
      .set({ status: runStatusFor(settled.status), completedAt: new Date() })
      .where(eq(agentSessionRun.id, run.id));
    outcome = 'succeeded';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'agent session run failed';
    await db
      .update(agentSessionRun)
      .set({ status: 'failed', lastError: message, completedAt: new Date() })
      .where(eq(agentSessionRun.id, run.id));
    outcome = 'failed';
  }

  // Relay whatever landed regardless of the drive outcome: a turn that crashed partway through
  // still very likely wrote thought/response/action rows worth mirroring to Linear, and a
  // completed/waiting/failed turn certainly did. Isolated in its own try/catch so a relay
  // failure (e.g. a revoked Linear install) never overwrites — or masks — the run status this
  // function just recorded above; it is simply retried from its own watermark next tick.
  try {
    await relayLinearAgentActivity(run.organizationId, run.sessionId);
  } catch (err) {
    console.warn('[linear-agent-sweep] relay failed for session', {
      sessionId: run.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return outcome;
}

/**
 * Sweep once: claim due `agent_session_run` rows, drive each session, and relay the result.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepLinearAgentSessions(now: Date): Promise<LinearAgentSweepResult> {
  const candidates = await db
    .select({ id: agentSessionRun.id })
    .from(agentSessionRun)
    .where(claimableCondition(now))
    .orderBy(asc(agentSessionRun.queuedAt))
    .limit(BATCH_LIMIT);

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const run = await claimRun(candidate.id, now);
    if (!run) continue; // lost the race to a concurrent sweep tick.
    claimed += 1;

    if ((await processRun(run)) === 'succeeded') succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed };
}
