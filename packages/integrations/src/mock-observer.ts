/**
 * `@docket/integrations` — `MockObserver`.
 *
 * @remarks
 * The offline {@link Observer} used in `APP_MODE ∈ {local,test}` and whenever no provider
 * webhook secret is configured. Signature verification is the trusted local path: it
 * accepts any present `linear-signature` header except the literal `"invalid"` (so route
 * tests can still exercise the 400 path deterministically). `route`/`normalize` parse the
 * payload generically and honor optional `kind`/`title`/`occurredAt`/`summary` overrides, so a
 * test fixture fully controls the canonical {@link EventDraft} the pipeline produces with no
 * Linear account; the fixture entity collapses to `entity.kind = 'work_item'` with a `generic`
 * detail.
 */
import { EventKind } from '@docket/types';

import { genericDetail } from './event-detail';
import { asRecord, str } from './json';
import type {
  EventDraft,
  EventEntityRef,
  InboundRouting,
  Observer,
  ObserverProvider,
  RawInboundEvent,
  VerifySignatureInput,
} from './observer';

/** Construction options for {@link MockObserver}. */
export interface MockObserverOptions {
  /** The provider this observer reports (defaults to `linear`). */
  readonly provider?: ObserverProvider;
}

/** The signature headers Docket's providers use; the mock accepts any one (local path). */
const SIGNATURE_HEADERS = [
  'linear-signature',
  'x-hub-signature-256',
  'x-signature-ed25519',
] as const;

/** A deterministic, offline {@link Observer} backed by the request payload itself. */
export class MockObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ObserverProvider;

  constructor(options: MockObserverOptions = {}) {
    this.provider = options.provider ?? 'linear';
  }

  /**
   * {@inheritDoc Observer.verifySignature} — trusted local path: accepts any present provider
   * signature header (any value except the literal `"invalid"`, so route tests still hit the 400).
   */
  verifySignature(input: VerifySignatureInput): boolean {
    const present = SIGNATURE_HEADERS.map((h) => input.headers[h]).find((v) => v !== undefined);
    return present !== undefined && present !== 'invalid';
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
  normalize(event: RawInboundEvent): EventDraft[] {
    const body = asRecord(event.payload) ?? {};
    const dedupeKey = this.route(body)?.externalEventId ?? `mock:${event.receivedAt}`;
    const kind: EventKind = EventKind.safeParse(str(body, 'kind')).data ?? 'mention';
    const title = str(body, 'title') ?? 'Mock observation';
    const summary = str(body, 'summary');
    const externalId = str(body, 'id');
    const fixtureTitle = str(body, 'title');
    const entity: EventEntityRef | undefined = externalId
      ? { kind: 'work_item', externalId, ...(fixtureTitle ? { title: fixtureTitle } : {}) }
      : undefined;
    // Optional fixture `participants`: an array of external actor ids (or `{ externalId }`), so a
    // test can drive the mention-attribution seam (mentioned users → recipients) deterministically.
    const participants = Array.isArray(body['participants'])
      ? (body['participants'] as unknown[]).flatMap((p) => {
          if (typeof p === 'string') return [{ externalId: p }];
          const id = str(asRecord(p), 'externalId');
          return id ? [{ externalId: id }] : [];
        })
      : undefined;
    return [
      {
        kind,
        occurredAt: str(body, 'occurredAt') ?? event.receivedAt,
        title,
        ...(summary ? { summary } : {}),
        ...(entity ? { entity } : {}),
        ...(participants?.length ? { participants } : {}),
        dedupeKey,
        detail: genericDetail(title, summary),
      },
    ];
  }
}
