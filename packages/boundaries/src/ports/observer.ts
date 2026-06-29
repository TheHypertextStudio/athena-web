/**
 * `@docket/boundaries/ports` — the `Observer` port.
 *
 * @remarks
 * The typed edge for **ambient context intelligence**: it turns an inbound provider
 * event (a Linear webhook, later a Slack/Calendar delivery) into normalized
 * {@link ObservationDraft}s for the knowledge timeline. It is the read/observe sibling
 * of the {@link Connector} port — where the Connector *pulls* work to materialize as
 * tasks, the Observer *receives* events to record as observations whose source of truth
 * stays external.
 *
 * Three responsibilities, all provider-specific and all pure (no Docket-tenancy
 * knowledge — the caller resolves org/user from {@link InboundRouting}):
 * 1. {@link Observer.verifySignature} — authenticate the raw request bytes.
 * 2. {@link Observer.route} — extract the routing identity (workspace + event id) so the
 *    caller can dedup and map the event to an integration *before* persisting it.
 * 3. {@link Observer.normalize} — map the parsed payload to zero-or-more observations.
 *
 * The real adapters verify real HMAC signatures and map real payloads; `MockObserver`
 * trusts the local path and emits fixture drafts so the pipeline runs with no accounts.
 */
import type { ConnectorProvider } from './connector';

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

/** The external person behind an observed action (matches `@docket/types` `ObservationActor`). */
export interface ObservationActorRef {
  /** The person's native id in the source system. */
  readonly externalId: string;
  /** Display name, when the provider exposes one. */
  readonly displayName?: string;
  /** Avatar URL, when known. */
  readonly avatar?: string;
}

/** The external object an observation is about (matches `@docket/types` `ObservationSubject`). */
export interface ObservationSubjectRef {
  /** Subject kind in the source system (e.g. `issue`, `comment`, `thread`). */
  readonly type: string;
  /** The subject's native id in the source system. */
  readonly externalId: string;
  /** Display title, when known. */
  readonly title?: string;
  /** Canonical URL, when available. */
  readonly url?: string;
}

/**
 * One normalized observation the caller will persist (tenancy resolved by the caller).
 *
 * @remarks
 * Mirrors the `observation` table's content columns minus the Docket-owned fields
 * (`organizationId`/`userId`/`integrationId`/`sourceEventId`), which the caller fills.
 * `kind` is the string form of `@docket/types` `ObservationKind`.
 */
export interface ObservationDraft {
  /** The high-level observation kind (a `@docket/types` `ObservationKind` value). */
  readonly kind: string;
  /** When it happened at the source (ISO-8601). */
  readonly occurredAt: string;
  /** Display title/headline. */
  readonly title: string;
  /** Optional supporting summary. */
  readonly summary?: string;
  /** Canonical URL of the source object, when available. */
  readonly permalink?: string;
  /** Who performed the action, when known. */
  readonly externalActor?: ObservationActorRef;
  /** What the action was about, when known. */
  readonly subject?: ObservationSubjectRef;
  /** Other people involved, when known. */
  readonly participants?: readonly ObservationActorRef[];
  /** The source object's native id. */
  readonly externalId?: string;
  /** A stable key that collapses duplicates of this observation within an org. */
  readonly dedupeKey: string;
  /** Normalized structured detail retained for later enrichment. */
  readonly payload?: Record<string, unknown>;
}

/**
 * The observer port: verify → route → normalize an inbound provider event.
 *
 * @remarks
 * Bound to a single provider (like the connector is), selected via `selectAdapter`. Read-only
 * with respect to Docket: it never writes; the caller persists the inbound event and the
 * resulting observations.
 */
export interface Observer {
  /** The provider this observer handles. */
  readonly provider: ConnectorProvider;

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
   * Normalize a raw event into zero-or-more observations.
   *
   * @param event - The event type, parsed payload, and receipt time.
   * @returns the observation drafts (empty when the event carries nothing worth recording).
   */
  normalize(event: RawInboundEvent): ObservationDraft[];
}
