/**
 * `@docket/boundaries/ports` — the `Observer` port (Adapter pattern).
 *
 * @remarks
 * The typed edge for the cross-tool activity feed: it turns an inbound provider event (a
 * Linear webhook, a GitHub delivery, a Slack event) into normalized {@link EventDraft}s in
 * the *canonical* shape — `kind` + `entity` + typed `detail` — so a Linear issue and a Docket
 * task arrive identically (`entity.kind = 'work_item'`) and render through one row. It is the
 * read/observe sibling of the {@link Connector} port.
 *
 * Three responsibilities, all provider-specific and pure (no Docket-tenancy knowledge — the
 * caller resolves org/user/source from {@link InboundRouting} + the bound provider):
 * 1. {@link Observer.verifySignature} — authenticate the raw request bytes.
 * 2. {@link Observer.route} — extract the routing identity (workspace + event id) so the
 *    caller can dedup and map the event to an integration *before* persisting it.
 * 3. {@link Observer.normalize} — map the parsed payload to zero-or-more canonical event drafts.
 *
 * Each adapter's `normalize` should map its native object types onto the closed
 * {@link CanonicalEntityKind} taxonomy and build a typed {@link EventDetail} via an ordered
 * chain of detail-builders ending in a `generic` fallback — so an event we don't yet have a
 * specific shape for still surfaces (a degraded row) instead of being dropped.
 */
import type { CanonicalEntityKind, EventDetail, EventKind } from '@docket/types';

import type { ConnectorProvider } from './connector';

/**
 * The providers an {@link Observer} can be bound to.
 *
 * @remarks
 * A superset of {@link ConnectorProvider}: every connector can also be observed, plus
 * **observe-only** sources that have no work-import connector (e.g. Slack, Discord). Keeping
 * observer providers as their own union avoids polluting `ConnectorProvider`'s exhaustive switches.
 */
export type ObserverProvider = ConnectorProvider | 'slack' | 'discord';

/** Inbound webhook request headers, lower-cased keys (Hono header lookup is case-insensitive). */
export type InboundHeaders = Record<string, string | undefined>;

/** Input to verify an inbound request is authentically from the provider. */
export interface VerifySignatureInput {
  /** The exact raw request body bytes (signatures are computed over these, never a re-parse). */
  readonly rawBody: string;
  /** The inbound request headers (the signature header is provider-specific). */
  readonly headers: InboundHeaders;
}

/** The identity an observer extracts from a payload so the caller can route + dedup it. */
export interface InboundRouting {
  /**
   * The provider's workspace/org id, matched against `integration.connection.externalWorkspaceId`.
   *
   * @remarks
   * How an inbound event is mapped to the Docket integration (and thus org + owning user)
   * for providers that identify their workspace in the payload (Linear). Absent for
   * providers routed by an opaque per-integration token in the ingest URL instead.
   */
  readonly externalWorkspaceId?: string;
  /** The provider's own event id — the idempotency/dedup key against webhook retries. */
  readonly externalEventId: string;
  /** The provider's event-type label (stored verbatim on the inbound event). */
  readonly eventType: string;
}

/** A raw inbound event handed to {@link Observer.normalize}. */
export interface RawInboundEvent {
  /** The provider's event-type label (from {@link InboundRouting.eventType}). */
  readonly eventType: string;
  /** The parsed JSON payload (verified upstream). */
  readonly payload: unknown;
  /** ISO-8601 timestamp the event was received (the fallback when the payload carries no time). */
  readonly receivedAt: string;
}

/**
 * The person behind an event, as the adapter sees it in its source.
 *
 * @remarks
 * The `source` and `docketActorId` of the canonical `ActorRef` are filled by the caller (the
 * source is the bound provider; the Docket mapping is resolved later), so the draft omits them.
 */
export interface EventActorRef {
  /** The person's native id in the source system. */
  readonly externalId: string;
  /** Display name, when the provider exposes one. */
  readonly displayName?: string;
  /** Avatar URL, when known. */
  readonly avatarUrl?: string;
}

/**
 * The canonical reference to the thing an event is about, as the adapter resolves it.
 *
 * @remarks
 * `kind` is the *canonical* entity kind (the adapter maps its native type — issue/PR/repo —
 * onto it). The `source` and `docketEntityId` are filled by the caller.
 */
export interface EventEntityRef {
  /** The canonical entity kind this maps onto. */
  readonly kind: CanonicalEntityKind;
  /** The entity's native id in the source system. */
  readonly externalId: string;
  /** Display title, when known. */
  readonly title?: string;
  /** Canonical URL, when available. */
  readonly url?: string;
}

/**
 * One normalized canonical event the caller will persist (tenancy + source resolved by the caller).
 *
 * @remarks
 * Mirrors the `event` table's content minus the Docket-owned fields
 * (`organizationId`/`userId`/`integrationId`/`sourceSystem`/`sourceEventId`). `kind` is a
 * `@docket/types` {@link EventKind}; `detail` is a typed {@link EventDetail} variant (incl. the
 * `generic` fallback).
 */
export interface EventDraft {
  /** The canonical event verb. */
  readonly kind: EventKind;
  /** When it happened at the source (ISO-8601). */
  readonly occurredAt: string;
  /** Display title/headline. */
  readonly title: string;
  /** Optional supporting summary. */
  readonly summary?: string;
  /** Canonical URL of the source object, when available. */
  readonly permalink?: string;
  /** Who performed the action, when known. */
  readonly actor?: EventActorRef;
  /** The canonical thing the event is about, when known. */
  readonly entity?: EventEntityRef;
  /** Other people involved, when known. */
  readonly participants?: readonly EventActorRef[];
  /** Typed, tool-specific detail (a closed-union variant, or `generic`). */
  readonly detail?: EventDetail;
  /** The source object's native id. */
  readonly externalId?: string;
  /** A stable key that collapses duplicates of this event within an org. */
  readonly dedupeKey: string;
}

/**
 * The observer port: verify → route → normalize an inbound provider event (Adapter pattern).
 *
 * @remarks
 * Bound to a single provider, selected via the `selectAdapter` registry. Read-only with respect
 * to Docket: it never writes; the caller persists the inbound event and the resulting events.
 */
export interface Observer {
  /** The provider this observer handles. */
  readonly provider: ObserverProvider;

  /**
   * Verify the inbound request is authentically from the provider.
   *
   * @param input - The raw body bytes and request headers.
   * @returns `true` when the signature is valid; `false` for missing/forged/tampered requests.
   */
  verifySignature(input: VerifySignatureInput): boolean;

  /**
   * Extract the routing identity (workspace, event id, type) from a parsed payload.
   *
   * @param payload - The parsed JSON request body.
   * @returns the routing identity, or `null` when the payload is unrecognized.
   */
  route(payload: unknown): InboundRouting | null;

  /**
   * Normalize a raw event into zero-or-more canonical event drafts.
   *
   * @param event - The event type, parsed payload, and receipt time.
   * @returns the event drafts (empty when the event carries nothing worth recording).
   */
  normalize(event: RawInboundEvent): EventDraft[];
}
