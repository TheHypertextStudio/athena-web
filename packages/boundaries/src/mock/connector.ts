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
import {
  CONNECTOR_ITEMS,
  FIXED_NOW,
  LINEAR_TEAM_STATES,
  LINEAR_WORK_GRAPH,
  MAIL_THREAD_SUMMARIES,
} from '../fixtures';
import type {
  ConnectInput,
  ConnectionResult,
  Connector,
  ConnectorProvider,
  ExternalWriteResult,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  LinkResult,
  ListContainersInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
  TaskPushOp,
  WritableConnector,
} from '../ports/connector';
import { WRITE_BACK_CAPABLE_PROVIDERS } from '../ports/connector';
import type {
  FetchThreadInput,
  ListThreadsInput,
  MailAction,
  MailActionInput,
  MailActions,
  MailListPage,
  MailThread,
} from '../ports/mail';
import { MAIL_CAPABLE_PROVIDERS } from '../ports/mail';
import type {
  ExternalWorkflowState,
  PullWorkGraphInput,
  WorkGraphConnector,
  WorkGraphSnapshot,
  WorkItemPushOp,
} from '../ports/work-graph';

/** One mailbox action recorded by {@link MockConnector} (record-only, for test assertions). */
export interface RecordedMailAction {
  readonly threadId: string;
  readonly action: MailAction;
}

/** Construction options for {@link MockConnector}. */
export interface MockConnectorOptions {
  /** Fixed ISO-8601 "now" used for mirror timestamps. */
  readonly now?: string;
  /**
   * The provider this mock is bound to, so {@link MockConnector.asWritable} can gate write-back
   * on `gtasks` exactly like {@link RealConnector}. Defaults to `github` (read-only).
   */
  readonly provider?: ConnectorProvider;
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
  private readonly provider: ConnectorProvider;
  private counter = 0;

  /**
   * Record-only log of mailbox actions applied through {@link MockConnector.asMailActor}.
   *
   * @remarks
   * The mock performs no I/O; it records every `(threadId, action)` here so tests can assert
   * intent offline (e.g. "completing a task with an email attachment archived its thread").
   */
  readonly mailActionLog: RecordedMailAction[] = [];

  /**
   * Record-only log of work-item write ops applied through {@link MockConnector.asWorkGraph}.
   *
   * @remarks
   * The mock performs no I/O; it records every {@link WorkItemPushOp} here (in call order) so
   * tests can assert reconciler intent offline, mirroring {@link MockConnector.mailActionLog}.
   */
  readonly workItemPushLog: WorkItemPushOp[] = [];

  /**
   * @param options - Optional fixed `now` and the bound provider for write-back gating.
   */
  constructor(options: MockConnectorOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
    this.provider = options.provider ?? 'github';
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(6, '0')}`;
  }

  /**
   * {@inheritDoc Connector.connect}
   *
   * @remarks
   * For `linear`, also stamps a fixed `externalWorkspaceId` so the webhook-routing and
   * work-graph code paths have a deterministic organization id to key off offline.
   */
  async connect(input: ConnectInput): Promise<ConnectionResult> {
    return {
      connectionId: this.nextId('conn'),
      provider: input.provider,
      status: 'connected',
      account: input.externalWorkspaceId ?? `${input.provider}-workspace`,
      ...(input.provider === 'linear' ? { externalWorkspaceId: 'mock-linear-org' } : {}),
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

  /**
   * A deterministic, monotonically-advancing ISO timestamp for write-back echoes.
   *
   * @remarks
   * Anchored to {@link MockConnector.now} and advanced by the per-mock counter so each
   * `pushTask` returns a strictly-newer `externalUpdatedAt` than the last — letting the echo
   * guard (`externalUpdatedAt = updatedAt`) settle without wall-clock time or randomness.
   */
  private nextStamp(): string {
    this.counter += 1;
    return new Date(new Date(this.now).getTime() + this.counter * 1000).toISOString();
  }

  /**
   * {@inheritDoc Connector.asWritable}
   *
   * @remarks
   * Gated by the declarative {@link WRITE_BACK_CAPABLE_PROVIDERS} manifest (mirroring the
   * real connectors' structural capability); non-write-back providers get `undefined`, so
   * the sync engine's write path is exercised offline.
   */
  asWritable(): WritableConnector | undefined {
    if (!WRITE_BACK_CAPABLE_PROVIDERS.has(this.provider)) return undefined;
    return { pushTask: (input) => this.pushTask(input.op) };
  }

  /** Apply one write op against the in-memory mock, echoing post-write sync anchors. */
  private async pushTask(op: TaskPushOp): Promise<ExternalWriteResult | undefined> {
    if (op.kind === 'delete') return;
    const stamp = this.nextStamp();
    return {
      externalId: op.kind === 'create' ? this.nextId('gtask') : op.externalId,
      externalUpdatedAt: stamp,
      externalEtag: `etag_${this.counter.toString().padStart(6, '0')}`,
    };
  }

  /**
   * The cursor value that makes the mock's `listThreads` report an expired cursor, so the
   * caller's full-repull fallback is exercisable offline.
   */
  static readonly EXPIRED_CURSOR = 'expired';

  /**
   * {@inheritDoc Connector.asMailActor}
   *
   * @remarks
   * Gated by the declarative {@link MAIL_CAPABLE_PROVIDERS} manifest (mirroring the real
   * connectors' structural capability). The returned {@link MailActions} is deterministic
   * and record-only: `listThreads` serves the provider's {@link MAIL_THREAD_SUMMARIES}
   * fixtures (cursor {@link MockConnector.EXPIRED_CURSOR} → `cursorExpired`),
   * `applyMailAction` appends to {@link MockConnector.mailActionLog} (no I/O), and
   * `fetchThread` returns a deterministic single-message fixture thread so the email-
   * attachment rendering path is exercised offline.
   */
  asMailActor(): MailActions | undefined {
    if (!MAIL_CAPABLE_PROVIDERS.has(this.provider)) return undefined;
    return {
      listThreads: async (input: ListThreadsInput): Promise<MailListPage> => {
        if (input.cursor === MockConnector.EXPIRED_CURSOR) return { kind: 'cursorExpired' };
        const fixtures = MAIL_THREAD_SUMMARIES[this.provider];
        if (!fixtures) {
          // A mail-capable provider without listing fixtures is a fixture bug — loud, not [].
          throw new Error(`No MAIL_THREAD_SUMMARIES fixtures for provider ${this.provider}`);
        }
        return {
          kind: 'page',
          threads: fixtures.slice(0, input.maxThreads),
          nextCursor: 'mock-cursor-1',
        };
      },
      applyMailAction: async (input: MailActionInput): Promise<void> => {
        this.mailActionLog.push({ threadId: input.threadId, action: input.action });
      },
      fetchThread: async (input: FetchThreadInput): Promise<MailThread> => ({
        threadId: input.threadId,
        subject: `Mock thread ${input.threadId}`,
        messages: [
          {
            id: `${input.threadId}-msg-1`,
            from: 'Ada Lovelace <ada@mock.docket.local>',
            to: ['you@mock.docket.local'],
            subject: `Mock thread ${input.threadId}`,
            snippet: 'This is a deterministic mock email body.',
            sentAt: this.now,
            rfc822MessageId: `<${input.threadId}-msg-1@mock.docket.local>`,
            references: [],
            bodyHtml: '<p>This is a deterministic mock email body.</p>',
          },
        ],
        externalUrl: `https://mail.mock.docket.local/#all/${input.threadId}`,
      }),
    };
  }

  /**
   * {@inheritDoc Connector.asWorkGraph}
   *
   * @remarks
   * Work-graph-capable for `linear` only (mirroring {@link MockConnector.asWritable} and
   * {@link MockConnector.asMailActor}) — a CONCRETE method, not omitted, so
   * `mock.asWorkGraph()` never throws for callers that skip the `?.`.
   */
  asWorkGraph(): WorkGraphConnector | undefined {
    if (this.provider !== 'linear') return undefined;
    return {
      pullWorkGraph: (input) => this.pullWorkGraph(input),
      listTeamStates: (externalTeamId) => this.listTeamStates(externalTeamId),
      pushWorkItem: (op) => this.pushWorkItem(op),
    };
  }

  /**
   * Filter {@link LINEAR_WORK_GRAPH} by team scope and incremental cutoff, matching
   * {@link import('../real/connector-linear').LinearProviderClient.pullWorkGraph}'s filter
   * semantics exactly.
   *
   * @remarks
   * `externalTeamIds` (when non-empty) scopes items/cycles by their own `externalTeamId` and
   * projects by intersection of `externalTeamIds`; users/labels are never filtered by team.
   * `updatedAfter` (when present) narrows ITEMS ONLY, by `updatedAt > updatedAfter` — the
   * same incremental cutoff the real client applies only to its issues pull. Every returned
   * array is a fresh copy so callers can't mutate the shared fixture.
   */
  private async pullWorkGraph(input: PullWorkGraphInput): Promise<WorkGraphSnapshot> {
    const scoped = input.externalTeamIds.length > 0;
    const selected = new Set(input.externalTeamIds);
    const items = LINEAR_WORK_GRAPH.items.filter((item) => {
      if (scoped && !selected.has(item.externalTeamId)) return false;
      if (input.updatedAfter !== undefined && !(item.updatedAt > input.updatedAfter)) {
        return false;
      }
      return true;
    });
    const cycles = LINEAR_WORK_GRAPH.cycles.filter(
      (cycle) => !scoped || selected.has(cycle.externalTeamId),
    );
    const projects = LINEAR_WORK_GRAPH.projects.filter(
      (project) => !scoped || project.externalTeamIds.some((id) => selected.has(id)),
    );
    return {
      users: [...LINEAR_WORK_GRAPH.users],
      labels: [...LINEAR_WORK_GRAPH.labels],
      projects,
      cycles,
      items,
    };
  }

  /**
   * Return the fixture {@link LINEAR_TEAM_STATES} for a team, matching
   * {@link import('../real/connector-linear').LinearProviderClient.listTeamStates}'s behavior
   * for an unrecognized team: an empty array, never a throw.
   */
  private async listTeamStates(externalTeamId: string): Promise<ExternalWorkflowState[]> {
    return [...(LINEAR_TEAM_STATES[externalTeamId] ?? [])];
  }

  /**
   * Record one work-item write op and echo deterministic post-write sync anchors.
   *
   * @remarks
   * Mirrors {@link MockConnector.pushTask}: the post-write timestamp comes from
   * {@link MockConnector.nextStamp}, and a `create` is assigned a fresh id via
   * {@link MockConnector.nextId} (an `update` echoes back its own `externalId`).
   */
  private async pushWorkItem(op: WorkItemPushOp): Promise<ExternalWriteResult> {
    this.workItemPushLog.push({ ...op });
    const stamp = this.nextStamp();
    return {
      externalId: op.kind === 'create' ? this.nextId('lin-issue-created') : op.externalId,
      externalUpdatedAt: stamp,
    };
  }

  /**
   * {@inheritDoc Connector.listContainers}
   *
   * @remarks
   * Returns two fixture Google Tasks lists for `gtasks` so the per-account "which lists to sync"
   * config UI has selectable data offline; every other provider has no containers.
   */
  async listContainers(input: ListContainersInput): Promise<ResourceRef[]> {
    if (input.provider !== 'gtasks') return [];
    return [
      { id: '@default', title: 'My Tasks' },
      { id: 'mock-list-work', title: 'Work' },
    ];
  }
}
