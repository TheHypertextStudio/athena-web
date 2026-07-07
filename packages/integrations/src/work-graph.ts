/**
 * `@docket/integrations` — the `WorkGraphConnector` capability.
 *
 * @remarks
 * A provider-agnostic rich pull of a work-tracking provider's graph (users, labels,
 * projects, cycles, work items) plus field-level push mutations back to a single work
 * item. Linear is the first (and, for now, only) provider that implements it — this is
 * the seam a rich GraphQL client ({@link WorkGraphConnector.pullWorkGraph}/
 * {@link WorkGraphConnector.listTeamStates}) and reconciler
 * ({@link WorkGraphConnector.pushWorkItem}) are built against. Discovered exactly like
 * {@link import('./connector').Connector.asWritable} and
 * {@link import('./connector').Connector.asMailActor}: a connector that is not
 * work-graph-capable omits {@link import('./connector').Connector.asWorkGraph} or
 * returns `undefined` there.
 */
import type { ExternalWriteResult } from './connector';

/**
 * The provider-agnostic lifecycle bucket of a work item's state.
 *
 * @remarks
 * Mirrors Linear's `WorkflowState.type` (its closest analogue), which every provider
 * this port targets is expected to be able to classify into.
 */
export type ExternalStateType =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled';

/** The provider-agnostic priority of a work item. */
export type ExternalPriority = 'none' | 'urgent' | 'high' | 'medium' | 'low';

/** One user known to the provider workspace. */
export interface ExternalUser {
  /** The provider's user UUID. */
  readonly externalId: string;
  /** The user's display name. */
  readonly displayName: string;
  /** The user's email, when the provider exposes one. */
  readonly email?: string;
  /** URL to the user's avatar image, when available. */
  readonly avatarUrl?: string;
  /** Whether the user is an active workspace member. */
  readonly active: boolean;
}

/** One label known to the provider workspace or one of its teams. */
export interface ExternalLabel {
  /** The provider's label UUID. */
  readonly externalId: string;
  /** The label's name. */
  readonly name: string;
  /** The label's color. */
  readonly color: string;
  /** The owning team's external id; absent means a workspace-level label. */
  readonly externalTeamId?: string;
}

/** One project known to the provider workspace. */
export interface ExternalProject {
  /** The provider's project UUID. */
  readonly externalId: string;
  /** The project's name. */
  readonly name: string;
  /** The project's description, when set. */
  readonly description?: string;
  /** The project's lifecycle state. */
  readonly state: 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled';
  /** The project lead's external user id, when assigned. */
  readonly leadExternalId?: string;
  /** The project's start date (RFC3339 date), when set. */
  readonly startDate?: string;
  /** The project's target date (RFC3339 date), when set. */
  readonly targetDate?: string;
  /** Canonical URL of the project in the provider. */
  readonly url: string;
  /**
   * The provider's own last-modified timestamp (RFC3339).
   *
   * @remarks
   * The last-write-wins anchor for the project mirror — see {@link ItemProvenance.externalUpdatedAt}
   * for the same convention on imported items.
   */
  readonly updatedAt: string;
  /** Set when the project is archived/trashed at the provider — a tombstone, not live content. */
  readonly removed?: boolean;
  /** The external ids of every team the project is shared with. */
  readonly externalTeamIds: readonly string[];
}

/** One cycle (sprint/iteration) known to a provider team. */
export interface ExternalCycle {
  /** The provider's cycle UUID. */
  readonly externalId: string;
  /** The owning team's external id. */
  readonly externalTeamId: string;
  /** The cycle's ordinal number within its team. */
  readonly number: number;
  /** The cycle's name, when the team names its cycles. */
  readonly name?: string;
  /** When the cycle starts (RFC3339). */
  readonly startsAt: string;
  /** When the cycle ends (RFC3339). */
  readonly endsAt: string;
  /** When the cycle was completed, when it has been. */
  readonly completedAt?: string;
  /** The provider's own last-modified timestamp (RFC3339) — the last-write-wins anchor. */
  readonly updatedAt: string;
  /** Set when the cycle is archived/trashed at the provider — a tombstone, not live content. */
  readonly removed?: boolean;
}

/** One work item (issue) known to the provider workspace. */
export interface ExternalWorkItem {
  /**
   * The provider's UUID for this item.
   *
   * @remarks
   * NOT the human-readable identifier — use {@link ExternalWorkItem.identifier} for display
   * and legacy re-key matching only. The UUID is the stable key for sync.
   */
  readonly externalId: string;
  /** The human-readable identifier (e.g. `ENG-123`) — display + legacy re-key only. */
  readonly identifier: string;
  /** The work item's title. */
  readonly title: string;
  /** The work item's description, when set. */
  readonly description?: string;
  /** The provider-agnostic lifecycle bucket of the item's current state. */
  readonly stateType: ExternalStateType;
  /** The provider's own name for the current state (e.g. `In Review`). */
  readonly stateName: string;
  /** The work item's priority. */
  readonly priority: ExternalPriority;
  /** The assignee's external user id, when assigned. */
  readonly assigneeExternalId?: string;
  /** The external ids of every label applied to the item. */
  readonly labelExternalIds: readonly string[];
  /** The owning project's external id, when the item belongs to one. */
  readonly projectExternalId?: string;
  /** The owning cycle's external id, when the item is scheduled into one. */
  readonly cycleExternalId?: string;
  /** The parent work item's external id, when this item is a sub-issue. */
  readonly parentExternalId?: string;
  /** The owning team's external id. */
  readonly externalTeamId: string;
  /** The item's point/size estimate, when set. */
  readonly estimate?: number;
  /** The item's due date (RFC3339 date), when set. */
  readonly dueDate?: string;
  /** When work started on the item, when known. */
  readonly startedAt?: string;
  /** When the item was completed, when it has been. */
  readonly completedAt?: string;
  /** When the item was canceled, when it has been. */
  readonly canceledAt?: string;
  /** Canonical URL of the item in the provider. */
  readonly url: string;
  /**
   * The provider's own last-modified timestamp (RFC3339).
   *
   * @remarks
   * The last-write-wins anchor AND echo guard for two-way sync — compared against the local
   * `updatedAt` to decide which side is newer, and against a just-pushed write's response to
   * suppress reprocessing our own echo. Same convention as {@link ItemProvenance.externalUpdatedAt}.
   */
  readonly updatedAt: string;
  /** Set when the item is archived/trashed at the provider — a tombstone, not live content. */
  readonly removed?: boolean;
}

/** One full or incremental pull of a provider workspace's work graph. */
export interface WorkGraphSnapshot {
  /** Every user pulled in this snapshot. */
  readonly users: readonly ExternalUser[];
  /** Every label pulled in this snapshot. */
  readonly labels: readonly ExternalLabel[];
  /** Every project pulled in this snapshot. */
  readonly projects: readonly ExternalProject[];
  /** Every cycle pulled in this snapshot. */
  readonly cycles: readonly ExternalCycle[];
  /** Every work item pulled in this snapshot. */
  readonly items: readonly ExternalWorkItem[];
}

/** Input to pull a provider workspace's work graph. */
export interface PullWorkGraphInput {
  /** The selected provider teams to scope the pull to; empty means every team. */
  readonly externalTeamIds: readonly string[];
  /** Pull only entities updated after this RFC3339 timestamp; absent means a full pull. */
  readonly updatedAfter?: string;
}

/** One workflow state defined on a provider team. */
export interface ExternalWorkflowState {
  /** The provider's workflow-state UUID. */
  readonly externalId: string;
  /** The state's name (e.g. `In Review`). */
  readonly name: string;
  /** The provider-agnostic lifecycle bucket this state belongs to. */
  readonly type: ExternalStateType;
  /** The state's ordinal position within its team's workflow. */
  readonly position: number;
}

/**
 * A field-level write to an external work item.
 *
 * @remarks
 * Every field is optional — only the fields present are changed. An explicit `null` on a
 * nullable field CLEARS it at the provider (e.g. unassigning, clearing the due date);
 * `undefined`/absent leaves the field untouched. Never `.nullable().optional()` conflated —
 * absence and explicit-clear are distinct and both meaningful here.
 */
export interface WorkItemPushFields {
  /** New title, when changed. */
  readonly title?: string;
  /** New description, when changed; `null` clears it. */
  readonly description?: string | null;
  /** New workflow state's external id, when changed. */
  readonly stateExternalId?: string;
  /** New priority, when changed. */
  readonly priority?: ExternalPriority;
  /** New assignee's external user id, when changed; `null` unassigns. */
  readonly assigneeExternalId?: string | null;
  /** New due date (RFC3339 date), when changed; `null` clears it. */
  readonly dueDate?: string | null;
  /** New estimate, when changed; `null` clears it. */
  readonly estimate?: number | null;
  /** The full replacement set of label external ids, when changed. */
  readonly labelExternalIds?: readonly string[];
}

/**
 * One write operation pushed back to a work-graph-capable provider.
 *
 * @remarks
 * `update` addresses an existing item by its external id; `create` addresses a team to
 * create the item under and requires a `title` (the only field the provider needs to
 * create an item). Sibling to {@link import('./connector').TaskPushOp} for the Google
 * Tasks write-back path — this is the work-item equivalent.
 */
export type WorkItemPushOp =
  | { readonly kind: 'update'; readonly externalId: string; readonly fields: WorkItemPushFields }
  | {
      readonly kind: 'create';
      readonly externalTeamId: string;
      readonly fields: WorkItemPushFields & { readonly title: string };
    };

/**
 * The work-graph capability of a connector: a rich pull of a provider workspace's
 * users/labels/projects/cycles/work-items, its teams' workflow states, and field-level
 * push mutations back to a single work item.
 *
 * @remarks
 * Exposed only by connectors that model a full work graph (today, Linear), discovered via
 * {@link import('./connector').Connector.asWorkGraph}. Read-only connectors and connectors
 * whose provider has no rich work-graph concept (GitHub/Drive/Gmail/Calendar/Google Tasks)
 * omit it or return `undefined` there.
 */
export interface WorkGraphConnector {
  /**
   * Pull the provider workspace's work graph, scoped to the selected teams.
   *
   * @param input - The selected teams and optional incremental cutoff.
   * @returns every users/labels/projects/cycles/items entity in scope.
   * @throws {ConnectorError} On auth (`auth`), throttle (`rate_limit`), or provider failure.
   */
  pullWorkGraph(input: PullWorkGraphInput): Promise<WorkGraphSnapshot>;

  /**
   * List the workflow states defined on a single team.
   *
   * @param externalTeamId - The team's external id.
   * @returns the team's workflow states, ordered by {@link ExternalWorkflowState.position}.
   * @throws {ConnectorError} On auth (`auth`), throttle (`rate_limit`), or provider failure.
   */
  listTeamStates(externalTeamId: string): Promise<ExternalWorkflowState[]>;

  /**
   * Apply one field-level write to a work item and return the post-write sync anchors.
   *
   * @param op - The create/update change to apply.
   * @returns the new external id and the post-write echo guard/etag.
   * @throws {ConnectorError} On auth (`auth`), throttle (`rate_limit`), or provider failure.
   */
  pushWorkItem(op: WorkItemPushOp): Promise<ExternalWriteResult>;
}
