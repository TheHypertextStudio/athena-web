/**
 * `@docket/api` — the proactive sweep: turn relevant observations into drafted agent plans.
 *
 * @remarks
 * The "chief of staff" trigger. For each recent `mention`/`assignment` that reached an opted-in
 * user (`hub.preferences.proactive.enabled`), it creates an approval-gated agent session
 * ({@link createSessionFromObservation}) and runs it ({@link runSession}) — Athena drafts a plan,
 * the user approves each step. Idempotent: the session's `external_run_ref`
 * (`observation:<id>:<user>`) unique index makes a re-scan a no-op, so the time window + batch
 * cap simply bound the work. Decoupled from the ingest write path so an LLM call never blocks a
 * webhook ACK or a domain mutation. Lease-free by design (idempotent inserts + retry-safe runs).
 */
import { actor, db, hub, observation, observationRecipient } from '@docket/db';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import { createSessionFromObservation, runSession } from './agent-session-runner';

/** Outcome of one proactive sweep. */
export interface ProactiveSweepResult {
  /** Candidate (mention/assignment, opted-in, recent) recipients examined. */
  readonly found: number;
  /** New agent sessions created this run. */
  readonly created: number;
  /** Sessions run to settle (`completed`/`awaiting_approval`) this run. */
  readonly ran: number;
}

/** Only look back this far, so a settled backlog isn't re-scanned forever. */
const PROACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Max sessions kicked off per sweep (cost + runaway guard). */
const PROACTIVE_BATCH = 25;

/** The brief seeded into the session from the observation. */
function buildPrompt(row: {
  reason: string;
  title: string;
  summary: string | null;
  permalink: string | null;
}): string {
  const parts = [`Draft a plan to handle this ${row.reason}: "${row.title}".`];
  if (row.summary) parts.push(`Context: ${row.summary}`);
  if (row.permalink) parts.push(`Link: ${row.permalink}`);
  return parts.join(' ');
}

/**
 * Run one proactive sweep: draft + run agent plans for recent relevant observations.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepProactiveSessions(now: Date): Promise<ProactiveSweepResult> {
  const since = new Date(now.getTime() - PROACTIVE_WINDOW_MS);
  const rows = await db
    .select({
      observationId: observationRecipient.observationId,
      userId: observationRecipient.userId,
      organizationId: observationRecipient.organizationId,
      reason: observationRecipient.reason,
      title: observation.title,
      summary: observation.summary,
      permalink: observation.permalink,
    })
    .from(observationRecipient)
    .innerJoin(observation, eq(observation.id, observationRecipient.observationId))
    .innerJoin(hub, eq(hub.userId, observationRecipient.userId))
    .where(
      and(
        inArray(observationRecipient.reason, ['mention', 'assignment']),
        gt(observationRecipient.occurredAt, since),
        sql`${hub.preferences} -> 'proactive' ->> 'enabled' = 'true'`,
      ),
    )
    .limit(PROACTIVE_BATCH);

  let created = 0;
  let ran = 0;
  for (const row of rows) {
    // Resolve the recipient's human Actor in the observation's org (the accountable initiator).
    const [act] = await db
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.userId, row.userId),
          eq(actor.organizationId, row.organizationId),
          eq(actor.kind, 'human'),
        ),
      )
      .limit(1);
    if (!act) continue;

    const externalRunRef = `observation:${row.observationId}:${row.userId}`;
    const trigger = row.reason === 'mention' ? 'mention' : 'assignment';
    const sessionId = await createSessionFromObservation(
      row.organizationId,
      act.id,
      externalRunRef,
      trigger,
      buildPrompt(row),
    );
    if (!sessionId) continue; // already drafted for this observation+user
    created += 1;
    try {
      await runSession(row.organizationId, sessionId);
      ran += 1;
    } catch {
      // Leave the session pending for the next sweep / inspection; never fail the batch.
    }
  }

  return { found: rows.length, created, ran };
}
