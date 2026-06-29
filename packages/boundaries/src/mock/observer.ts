/**
 * `@docket/boundaries/mock` — `MockObserver`.
 *
 * @remarks
 * The offline {@link Observer} used in `APP_MODE ∈ {local,test}` and whenever no provider
 * webhook secret is configured. Signature verification is the trusted local path: it
 * accepts any present `linear-signature` header except the literal `"invalid"` (so route
 * tests can still exercise the 400 path deterministically). `route`/`normalize` parse the
 * payload generically and honor optional `kind`/`title`/`occurredAt` overrides, so a test
 * fixture fully controls the observation the pipeline produces with no Linear account.
 */
import { asRecord, str } from '../json';
import type { ConnectorProvider } from '../ports/connector';
import type {
  InboundRouting,
  Observer,
  ObservationDraft,
  RawInboundEvent,
  VerifySignatureInput,
} from '../ports/observer';

/** Construction options for {@link MockObserver}. */
export interface MockObserverOptions {
  /** The provider this observer reports (defaults to `linear`). */
  readonly provider?: ConnectorProvider;
}

/** A deterministic, offline {@link Observer} backed by the request payload itself. */
export class MockObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ConnectorProvider;

  constructor(options: MockObserverOptions = {}) {
    this.provider = options.provider ?? 'linear';
  }

  /** {@inheritDoc Observer.verifySignature} — trusted local path; only `"invalid"` is rejected. */
  verifySignature(input: VerifySignatureInput): boolean {
    const sig = input.headers['linear-signature'];
    return sig !== undefined && sig !== 'invalid';
  }

  /** {@inheritDoc Observer.route} */
  route(payload: unknown): InboundRouting | null {
    const body = asRecord(payload);
    if (!body) return null;
    const type = str(body, 'type') ?? 'mock';
    const externalWorkspaceId = str(body, 'organizationId') ?? 'mock-workspace';
    const externalEventId =
      str(body, 'externalEventId') ?? `mock:${type}:${str(body, 'id') ?? '0'}`;
    return { externalWorkspaceId, externalEventId, eventType: type };
  }

  /** {@inheritDoc Observer.normalize} — one draft, honoring optional fixture overrides. */
  normalize(event: RawInboundEvent): ObservationDraft[] {
    const body = asRecord(event.payload) ?? {};
    const dedupeKey = this.route(body)?.externalEventId ?? `mock:${event.receivedAt}`;
    return [
      {
        kind: str(body, 'kind') ?? 'mention',
        occurredAt: str(body, 'occurredAt') ?? event.receivedAt,
        title: str(body, 'title') ?? 'Mock observation',
        ...(str(body, 'summary') ? { summary: str(body, 'summary') } : {}),
        dedupeKey,
        payload: body,
      },
    ];
  }
}
