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
export const StreamRelevance = z
  .enum(['mention', 'assignment', 'owned', 'followed', 'participant'])
  .describe(
    "Why an event surfaced in a recipient's PERSONAL stream: `mention` (they were @-mentioned), `assignment` (work was assigned to them), `owned` (they own the subject), `followed` (they follow it), or `participant` (they participated, e.g. commented). Always `null` in the org-wide workspace firehose, which is not relevance-curated.",
  );
/** Stream-relevance value. */
export type StreamRelevance = z.infer<typeof StreamRelevance>;

/** Where a stream event came from — the attribution shown as a source badge. */
export const StreamSource = z
  .object({
    provider: z
      .string()
      .describe(
        'The source system the event came from (`docket`, `linear`, `slack`, `github`, …) — drives the source badge.',
      ),
    integrationId: IntegrationId.nullable().describe(
      'The integration the event was sourced through; null for internal `docket` events.',
    ),
    origin: z
      .enum(['docket', 'external'])
      .describe(
        'Coarse origin: `docket` (a Docket-internal event) vs `external` (an inbound webhook from a connected tool).',
      ),
  })
  .meta({ id: 'StreamSource', description: 'Attribution for a stream event.' });
/** Stream-source value. */
export type StreamSource = z.infer<typeof StreamSource>;

/** Derived, source-agnostic rendering hints so the row can pick a glyph/grouping. */
export const StreamRendering = z
  .object({
    icon: z
      .string()
      .describe(
        'Stable icon key for the kind glyph, resolved client-side to a concrete icon (so the server stays UI-agnostic).',
      ),
    category: z
      .string()
      .describe(
        'Coarse category for grouping/tone (e.g. `inbound`, `progress`, `social`) — lets the row pick a visual grouping without coupling to the source.',
      ),
  })
  .meta({ id: 'StreamRendering', description: 'Source-agnostic rendering hints for a row.' });
/** Stream-rendering value. */
export type StreamRendering = z.infer<typeof StreamRendering>;

/** One event in the unified stream — a read-projection of an observation. */
export const StreamEventOut = z
  .object({
    id: ObservationId.describe(
      'The id of the underlying observation this event projects — also the keyset paging tiebreaker.',
    ),
    organizationId: OrganizationId.describe('The organization the event belongs to.'),
    source: StreamSource.describe(
      'Attribution: which provider/integration and whether it is a Docket-internal or external event.',
    ),
    kind: ObservationKind.describe(
      'The canonical kind of activity (message/mention/assignment/status_change/…).',
    ),
    occurredAt: z
      .string()
      .describe(
        'When it happened AT THE SOURCE (ISO-8601) — the timeline sort key (with `id` as tiebreaker), distinct from `createdAt`.',
      ),
    title: z.string().describe("The event's headline as rendered in the row."),
    summary: z
      .string()
      .nullable()
      .describe('A secondary line of detail; null when the source provides none.'),
    permalink: z
      .string()
      .nullable()
      .describe('A deep link back to the event in its source tool; null when none is available.'),
    actor: ObservationActor.nullable().describe(
      'The external person who performed the action; null when not attributable.',
    ),
    subject: ObservationSubject.nullable().describe(
      'The external object the event is about (issue/thread/channel/event); null when none.',
    ),
    participants: z
      .array(ObservationActor)
      .describe('Other external people involved in the event (may be empty).'),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        'The raw provider payload, preserved without coercion so kind-specific detail slots can render source-native fields.',
      ),
    relevance: StreamRelevance.nullable().describe(
      'Why this reached the caller in the PERSONAL stream; always null in the org-wide workspace firehose.',
    ),
    rendering: StreamRendering.describe(
      'Derived, source-agnostic rendering hints (icon key + category) for the row.',
    ),
    createdAt: z
      .string()
      .describe(
        'ISO-8601 timestamp the observation was ingested into Docket (distinct from `occurredAt`, when it happened at the source).',
      ),
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
  filter: z
    .string()
    .optional()
    .describe(
      'base64-encoded JSON `ViewFilter[]` (the same stored shape saved views use), translated to SQL server-side. Composes (AND) with `provider`/`kind`.',
    ),
  viewId: z
    .string()
    .optional()
    .describe('A saved view id whose stored filters are loaded and applied server-side.'),
  provider: z
    .string()
    .optional()
    .describe('Quick-filter to a single source provider (e.g. `linear`).'),
  kind: ObservationKind.optional().describe('Quick-filter to a single canonical observation kind.'),
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
