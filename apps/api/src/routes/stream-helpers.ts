/**
 * `@docket/api` — serialize an `observation` row into the unified {@link StreamEventOut}.
 *
 * @remarks
 * One projection shared by both stream surfaces (cross-org personal + per-workspace). The
 * row carries provider attribution (`source`), the preserved `payload`, and a derived
 * `rendering` hint so heterogeneous origins render through one homogeneous row. `relevance`
 * is the recipient reason on the personal feed, and `null` on the workspace firehose.
 */
import { db, observation } from '@docket/db';
import type { ObservationKind, StreamEventOut, StreamRelevance } from '@docket/types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { publish } from '../lib/event-bus';

/** The selected `observation` row shape. */
type ObservationRow = typeof observation.$inferSelect;

/** Coarse rendering category per kind — drives grouping/tone, source-agnostic. */
function categoryFor(kind: ObservationKind): string {
  switch (kind) {
    case 'mention':
    case 'comment':
    case 'message':
    case 'reaction':
      return 'social';
    case 'assignment':
    case 'task_assignment':
      return 'inbound';
    case 'status_change':
    case 'completed':
    case 'created':
      return 'progress';
    case 'calendar_invite':
    case 'calendar_update':
      return 'calendar';
    default:
      return 'other';
  }
}

/**
 * Project one observation row (+ its personal-feed relevance) to the stream DTO.
 *
 * @param row - The observation row.
 * @param relevance - The recipient reason (personal feed), or `null` (workspace firehose).
 */
export function toStreamEventOut(
  row: ObservationRow,
  relevance: StreamRelevance | null,
): z.input<typeof StreamEventOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: {
      provider: row.provider,
      integrationId: row.integrationId,
      origin: row.provider === 'docket' ? 'docket' : 'external',
    },
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    title: row.title,
    summary: row.summary,
    permalink: row.permalink,
    actor: row.externalActor,
    subject: row.subject,
    participants: row.participants,
    payload: row.payload,
    relevance,
    rendering: { icon: row.kind, category: categoryFor(row.kind) },
    createdAt: row.createdAt.toISOString(),
  };
}

/** One recipient of a freshly-created observation, with the reason it concerns them. */
export interface StreamRecipient {
  readonly userId: string;
  readonly reason: StreamRelevance;
}

/**
 * Publish a just-created observation to its recipients' live SSE connections (best-effort).
 *
 * @remarks
 * Fetches the row once and fans `toStreamEventOut(row, reason)` to each recipient via the
 * in-process {@link publish} bus. Called after the emit/drain inserts commit; never throws into
 * the caller's write path (a publish failure must not roll back recorded work — caller catches).
 *
 * @param observationId - The observation just inserted.
 * @param recipients - The users it reached, with each one's relevance reason.
 */
export async function publishStreamEvent(
  observationId: string,
  recipients: readonly StreamRecipient[],
): Promise<void> {
  if (recipients.length === 0) return;
  const [row] = await db
    .select()
    .from(observation)
    .where(eq(observation.id, observationId))
    .limit(1);
  if (!row) return;
  for (const r of recipients) publish(r.userId, toStreamEventOut(row, r.reason));
}
