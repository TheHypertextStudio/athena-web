/**
 * `@docket/api` — project an `event` row into the unified {@link StreamEventOut}.
 *
 * @remarks
 * One projection shared by both feed surfaces (cross-org personal + per-workspace). The row
 * carries typed `source` attribution, the canonical `entity`/`actor`, the typed `detail`, and a
 * derived `rendering` hint so heterogeneous origins render through one homogeneous row.
 * `relevance` is the recipient reason on the personal feed, and `null` on the workspace firehose.
 */
import { db, event } from '@docket/db';
import type { EventKind, StreamEventOut, StreamRelevance } from '@docket/types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { publish } from '../lib/event-bus';

/** The selected `event` row shape. */
type EventRow = typeof event.$inferSelect;

/** Coarse rendering category per kind — drives grouping/tone, source-agnostic. */
function categoryFor(kind: EventKind): string {
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
 * Project one event row (+ its personal-feed relevance) to the feed DTO.
 *
 * @param row - The event row.
 * @param relevance - The recipient reason (personal feed), or `null` (workspace firehose).
 */
export function toStreamEventOut(
  row: EventRow,
  relevance: StreamRelevance | null,
): z.input<typeof StreamEventOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: {
      system: row.sourceSystem,
      integrationId: row.integrationId,
      externalUrl: row.externalUrl,
    },
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    title: row.title,
    summary: row.summary,
    permalink: row.permalink,
    actor: row.actor,
    entity: row.entity,
    participants: row.participants,
    detail: row.detail,
    relevance,
    rendering: { icon: row.kind, category: categoryFor(row.kind) },
    createdAt: row.createdAt.toISOString(),
  };
}

/** One recipient of a freshly-created event, with the reason it concerns them. */
export interface StreamRecipient {
  readonly userId: string;
  readonly reason: StreamRelevance;
}

/**
 * Publish a just-created event to its recipients' live SSE connections (best-effort).
 *
 * @remarks
 * Fetches the row once and fans `toStreamEventOut(row, reason)` to each recipient via the
 * in-process {@link publish} bus. Called after the emit/drain inserts commit; never throws into
 * the caller's write path (the caller catches).
 *
 * @param eventId - The event just inserted.
 * @param recipients - The users it reached, with each one's relevance reason.
 */
export async function publishEvent(
  eventId: string,
  recipients: readonly StreamRecipient[],
): Promise<void> {
  if (recipients.length === 0) return;
  const [row] = await db.select().from(event).where(eq(event.id, eventId)).limit(1);
  if (!row) return;
  for (const r of recipients) publish(r.userId, toStreamEventOut(row, r.reason));
}
