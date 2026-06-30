/**
 * `@docket/types` — unified event-stream DTOs (the first-class "Pulse" surface).
 *
 * @remarks
 * A StreamEvent is the read-shape of one {@link ObservationOut} as rendered in the
 * cross-org personal stream and the per-workspace firehose. It is deliberately a thin
 * projection over `observation`: the canonical columns stay lean, provider-specific
 * detail rides in `payload`, and `source` carries the attribution badge so heterogeneous
 * origins (Docket, Linear, Slack, GitHub, …) render through one homogeneous row.
 *
 * Every `*Out` field maps to a serialized value, so nullable fields are `.nullable()`
 * (present, possibly null) — never `.nullable().optional()`.
 */
import { z } from 'zod';

import { ObservationActor, ObservationKind, ObservationSubject } from './observation';
import { ListQuery, pageOf } from './pagination';
import { IntegrationId, ObservationId, OrganizationId } from './primitives';

/**
 * Why an event reached the caller's personal stream.
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

/** Where a stream event came from — the attribution shown as a source badge. */
export const StreamSource = z
  .object({
    /** The source system (`docket`, `linear`, `slack`, `github`, …). */
    provider: z.string(),
    /** The integration it was sourced through (null for internal `docket` events). */
    integrationId: IntegrationId.nullable(),
    /** Coarse origin: a Docket-internal event vs an external webhook. */
    origin: z.enum(['docket', 'external']),
  })
  .meta({ id: 'StreamSource', description: 'Attribution for a stream event.' });
/** Stream-source value. */
export type StreamSource = z.infer<typeof StreamSource>;

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

/** One event in the unified stream — a read-projection of an observation. */
export const StreamEventOut = z
  .object({
    id: ObservationId,
    organizationId: OrganizationId,
    source: StreamSource,
    kind: ObservationKind,
    /** When it happened at the source (ISO-8601) — the timeline sort key. */
    occurredAt: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    permalink: z.string().nullable(),
    actor: ObservationActor.nullable(),
    subject: ObservationSubject.nullable(),
    participants: z.array(ObservationActor),
    /** The raw provider payload, preserved (no coercion) for kind-specific detail slots. */
    payload: z.record(z.string(), z.unknown()),
    /** Why this reached the caller (personal stream); null in the workspace firehose. */
    relevance: StreamRelevance.nullable(),
    rendering: StreamRendering,
    createdAt: z.string(),
  })
  .meta({ id: 'StreamEventOut', description: 'One event in the unified stream.' });
/** Stream-event representation value. */
export type StreamEventOut = z.infer<typeof StreamEventOut>;

/**
 * Query params for the stream read endpoints.
 *
 * @remarks
 * Extends {@link ListQuery} (cursor + limit + order). `filter` is a base64-encoded JSON
 * `ViewFilter[]` (the same stored shape saved views use), translated to SQL server-side;
 * `viewId` loads a saved view's filters on the server. `provider`/`kind` are convenience
 * quick-filters that compose (AND) with `filter`.
 */
export const StreamQuery = ListQuery.extend({
  /** base64(JSON `ViewFilter[]`) — attribute filters applied in SQL. */
  filter: z.string().optional(),
  /** A saved view whose stored filters are applied server-side. */
  viewId: z.string().optional(),
  /** Quick-filter by source provider. */
  provider: z.string().optional(),
  /** Quick-filter by canonical kind. */
  kind: ObservationKind.optional(),
});
/** Validated stream-query value. */
export type StreamQuery = z.infer<typeof StreamQuery>;

/** A cursor-paginated page of stream events. */
export const StreamPageOut = pageOf(StreamEventOut).meta({
  id: 'StreamPageOut',
  description: 'A page of stream events.',
});
/** Stream-page representation value. */
export type StreamPageOut = z.infer<typeof StreamPageOut>;
