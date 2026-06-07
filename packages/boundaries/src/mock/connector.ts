/**
 * `@docket/boundaries/mock` — `MockConnector`.
 *
 * @remarks
 * A deterministic, offline {@link Connector} returning the fixture
 * {@link CONNECTOR_ITEMS} (issues/docs/events with provenance) for every provider. No
 * wall-clock time and no randomness: connection ids derive from inputs + a per-mock
 * counter and timestamps anchor to an injectable `now` (defaulting to
 * {@link FIXED_NOW}). Exercises the import / read-only-mirror / link logic offline.
 */
import { CONNECTOR_ITEMS, FIXED_NOW } from '../fixtures';
import type {
  ConnectInput,
  ConnectionResult,
  Connector,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  LinkResult,
  MirrorResult,
  MirrorStatusInput,
} from '../ports/connector';

/** Construction options for {@link MockConnector}. */
export interface MockConnectorOptions {
  /** Fixed ISO-8601 "now" used for mirror timestamps. */
  readonly now?: string;
}

/**
 * A mock connector backed by deterministic fixtures.
 *
 * @remarks
 * `connect` always succeeds; `importWork` returns the fixture items for the provider;
 * `mirrorStatus` reports an `idle` mirror sized to the fixture; `linkResource` echoes
 * the link as established.
 */
export class MockConnector implements Connector {
  private readonly now: string;
  private counter = 0;

  /**
   * @param options - Optional fixed `now` for deterministic timestamps.
   */
  constructor(options: MockConnectorOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(6, '0')}`;
  }

  /** {@inheritDoc Connector.connect} */
  async connect(input: ConnectInput): Promise<ConnectionResult> {
    return {
      connectionId: this.nextId('conn'),
      provider: input.provider,
      status: 'connected',
      account: input.externalWorkspaceId ?? `${input.provider}-workspace`,
    };
  }

  /** {@inheritDoc Connector.importWork} */
  async importWork(input: ImportWorkInput): Promise<ImportedItem[]> {
    return [...CONNECTOR_ITEMS[input.provider]];
  }

  /** {@inheritDoc Connector.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    return {
      connectionId: input.connectionId,
      status: 'idle',
      lastSyncedAt: this.now,
      itemCount: CONNECTOR_ITEMS[input.provider].length,
    };
  }

  /** {@inheritDoc Connector.linkResource} */
  async linkResource(input: LinkResourceInput): Promise<LinkResult> {
    return {
      resourceId: input.resourceId,
      externalId: input.externalId,
      externalUrl: `https://${input.provider}.mock.docket.local/${input.externalId}`,
      linked: true,
    };
  }
}
