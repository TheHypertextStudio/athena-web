/**
 * `@docket/types` — unified activity-feed DTOs (the first-class "Pulse" surface).
 *
 * @remarks
 * A StreamEvent is the read-shape of one {@link EventOut} as rendered in the cross-org
 * personal feed and the per-workspace firehose. It is a thin projection over the canonical
 * `event` log: heterogeneous origins (Docket, Linear, Slack, GitHub, …) render through one
 * homogeneous row because analogous things share a canonical {@link EntityRef} kind and the
 * `source` carries only the attribution badge. Provider-specific data rides in the typed
 * {@link EventDetail} pocket — never a contract-free blob.
 *
 * Every `*Out` field maps to a serialized value, so nullable fields are `.nullable()` —
 * never `.nullable().optional()`.
 */
import { z } from 'zod';

import { CanonicalEntityKind, EventKind, EventOut, SourceSystemKind } from './event';
import { ListQuery, pageOf } from './pagination';

/**
 * Why an event reached the caller's personal feed.
 *
 * @remarks
 * Mirrors the `stream_relevance` DB enum. The per-workspace firehose has no relevance
 * (it shows every org event), so {@link StreamEventOut.relevance} is `.nullable()`.
 */
export const StreamRelevance = z.enum([
  'mention',
  'assignment',
  'owned',
  'followed',
  'participant',
]);
/** Stream-relevance value. */
export type StreamRelevance = z.infer<typeof StreamRelevance>;

/** Derived, source-agnostic rendering hints so the row can pick a glyph/grouping. */
export const StreamRendering = z
  .object({
    /** Stable icon key for the kind glyph (resolved client-side to a real icon). */
    icon: z.string(),
    /** Coarse category for grouping/tone (e.g. `inbound`, `progress`, `social`). */
    category: z.string(),
  })
  .meta({ id: 'StreamRendering', description: 'Source-agnostic rendering hints for a row.' });
/** Stream-rendering value. */
export type StreamRendering = z.infer<typeof StreamRendering>;

/**
 * One event in the unified feed — a read-projection of a canonical {@link EventOut}.
 *
 * @remarks
 * Reuses the canonical `source`/`actor`/`entity`/`detail` shapes verbatim (one contract,
 * not a parallel one) and adds the feed-only `relevance` + `rendering`. The client derives
 * the coarse origin badge from `source.system === 'docket'`.
 */
export const StreamEventOut = EventOut.omit({ userId: true, externalId: true })
  .extend({
    /** Why this reached the caller (personal feed); null in the workspace firehose. */
    relevance: StreamRelevance.nullable(),
    rendering: StreamRendering,
  })
  .meta({ id: 'StreamEventOut', description: 'One event in the unified activity feed.' });
/** Stream-event representation value. */
export type StreamEventOut = z.infer<typeof StreamEventOut>;

/**
 * Query params for the feed read endpoints.
 *
 * @remarks
 * Extends {@link ListQuery} (cursor + limit + order). `filter` is a base64-encoded JSON
 * `ViewFilter[]` (the same stored shape saved views use), translated to SQL server-side;
 * `viewId` loads a saved view's filters on the server. `system`/`kind`/`entityKind` are
 * convenience quick-filters that compose (AND) with `filter`.
 */
export const StreamQuery = ListQuery.extend({
  /** base64(JSON `ViewFilter[]`) — attribute filters applied in SQL. */
  filter: z.string().optional(),
  /** A saved view whose stored filters are applied server-side. */
  viewId: z.string().optional(),
  /** Quick-filter by source system. */
  system: SourceSystemKind.optional(),
  /** Quick-filter by canonical event kind. */
  kind: EventKind.optional(),
  /** Quick-filter by canonical entity kind. */
  entityKind: CanonicalEntityKind.optional(),
});
/** Validated stream-query value. */
export type StreamQuery = z.infer<typeof StreamQuery>;

/** A cursor-paginated page of feed events. */
export const StreamPageOut = pageOf(StreamEventOut).meta({
  id: 'StreamPageOut',
  description: 'A page of feed events.',
});
/** Stream-page representation value. */
export type StreamPageOut = z.infer<typeof StreamPageOut>;
