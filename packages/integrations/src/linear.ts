import type {
  ExternalWriteResult,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
} from './connector';
import { ConnectorError } from './connector-error';
import type {
  ExternalCycle,
  ExternalLabel,
  ExternalPriority,
  ExternalProject,
  ExternalStateType,
  ExternalUser,
  ExternalWorkItem,
  ExternalWorkflowState,
  PullWorkGraphInput,
  WorkGraphSnapshot,
  WorkItemPushFields,
  WorkItemPushOp,
} from './work-graph';
import type { ResolvedAccount, WorkGraphProviderClient } from './provider-client';
import type { ProviderHttp } from './provider-http';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';

/** The lifecycle state a Linear project can be in (mirrors {@link ExternalProject.state}). */
type ExternalProjectState = ExternalProject['state'];

/**
 * The subset of Linear's `IssueUpdateInput`/`IssueCreateInput` this client writes.
 *
 * @remarks
 * Every field is optional so a push sends only what changed. A nullable field carrying an
 * explicit `null` CLEARS it at Linear; an omitted key leaves it untouched.
 */
interface LinearIssueInputBody {
  title?: string;
  description?: string | null;
  stateId?: string;
  priority?: number;
  assigneeId?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  labelIds?: readonly string[];
}

/** Raise a typed mapping failure so an unrecognized provider value fails the sync, never silently. */
function mappingError(message: string): ConnectorError {
  return new ConnectorError(`linear mapping error: ${message}`, {
    provider: 'linear',
    kind: 'provider',
  });
}

/**
 * Linear's numeric priority scale (`0`–`4`) keyed to the provider-agnostic {@link ExternalPriority}.
 *
 * @remarks
 * `0` is Linear's "No priority"; `1` is its most-urgent. The reverse map
 * ({@link toLinearPriority}) is the exact inverse used when pushing.
 */
const PRIORITY_BY_LINEAR_NUMBER: Readonly<Record<number, ExternalPriority>> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

/** The inverse of {@link PRIORITY_BY_LINEAR_NUMBER} — {@link ExternalPriority} back to Linear's number. */
const LINEAR_NUMBER_BY_PRIORITY: Readonly<Record<ExternalPriority, number>> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/** The full set of {@link ExternalStateType} values, for validating a raw `WorkflowState.type`. */
const EXTERNAL_STATE_TYPES: ReadonlySet<string> = new Set<ExternalStateType>([
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]);

/** The full set of {@link ExternalProjectState} values, for validating a raw `Project.state`. */
const EXTERNAL_PROJECT_STATES: ReadonlySet<string> = new Set<ExternalProjectState>([
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
]);

/**
 * Map Linear's numeric issue priority onto the provider-agnostic {@link ExternalPriority}.
 *
 * @param value - Linear's `Issue.priority` (`0`–`4`).
 * @returns the agnostic priority.
 * @throws {ConnectorError} (`provider`) when the number is outside Linear's documented scale — a
 *   data-shape surprise fails the sync rather than silently defaulting.
 */
export function mapLinearPriority(value: number): ExternalPriority {
  const mapped = PRIORITY_BY_LINEAR_NUMBER[value];
  if (mapped === undefined) throw mappingError(`unknown priority ${value}`);
  return mapped;
}

/**
 * Map a provider-agnostic {@link ExternalPriority} back onto Linear's numeric scale for a push.
 *
 * @param priority - The agnostic priority.
 * @returns Linear's `0`–`4` priority number.
 */
export function toLinearPriority(priority: ExternalPriority): number {
  return LINEAR_NUMBER_BY_PRIORITY[priority];
}

/**
 * Map a raw Linear `WorkflowState.type` string onto the {@link ExternalStateType} union.
 *
 * @param value - Linear's state type (e.g. `started`).
 * @returns the identical value, once validated to be a known member.
 * @throws {ConnectorError} (`provider`) on an unrecognized value — no silent fallback.
 */
export function mapLinearStateType(value: string): ExternalStateType {
  if (!EXTERNAL_STATE_TYPES.has(value)) throw mappingError(`unknown state type "${value}"`);
  return value as ExternalStateType;
}

/**
 * Map a raw Linear `Project.state` string onto the {@link ExternalProject.state} union.
 *
 * @param value - Linear's project state (e.g. `planned`).
 * @returns the identical value, once validated to be a known member.
 * @throws {ConnectorError} (`provider`) on an unrecognized value — no silent fallback.
 */
export function mapLinearProjectState(value: string): ExternalProjectState {
  if (!EXTERNAL_PROJECT_STATES.has(value)) throw mappingError(`unknown project state "${value}"`);
  return value as ExternalProjectState;
}

/** One `{ id }` reference node as Linear returns for a related entity. */
interface RawIdRef {
  readonly id: string;
}

/** A `{ nodes: [...] }` sub-connection (no pagination), e.g. an issue's labels. */
interface RawNodeList<N> {
  readonly nodes?: readonly N[];
}

/** A paginated Linear GraphQL connection: its page of `nodes` plus the `pageInfo` cursor. */
interface RawConnection<N> {
  readonly nodes?: readonly N[];
  readonly pageInfo?: { readonly hasNextPage: boolean; readonly endCursor?: string };
}

/** Raw Linear `User` node from the users query. */
interface RawUserNode {
  readonly id: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly email?: string | null;
  readonly avatarUrl?: string | null;
  readonly active: boolean;
}

/** Raw Linear `IssueLabel` node from the labels query. */
interface RawLabelNode {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly team?: RawIdRef | null;
}

/** Raw Linear `Project` node from the projects query. */
interface RawProjectNode {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly state: string;
  readonly url: string;
  readonly startDate?: string | null;
  readonly targetDate?: string | null;
  readonly archivedAt?: string | null;
  readonly updatedAt: string;
  readonly lead?: RawIdRef | null;
  readonly teams?: RawNodeList<RawIdRef>;
}

/** Raw Linear `Cycle` node from the cycles query. */
interface RawCycleNode {
  readonly id: string;
  readonly number: number;
  readonly name?: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt?: string | null;
  readonly updatedAt: string;
  readonly team?: RawIdRef | null;
}

/** Raw Linear `WorkflowState` node from the team-states query. */
interface RawStateNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly position: number;
}

/** Raw Linear `Issue` node from the issues query. */
interface RawIssueNode {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description?: string | null;
  readonly url: string;
  readonly priority: number;
  readonly estimate?: number | null;
  readonly dueDate?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly canceledAt?: string | null;
  readonly archivedAt?: string | null;
  readonly trashed?: boolean | null;
  readonly updatedAt: string;
  readonly state: RawStateNode;
  readonly assignee?: RawIdRef | null;
  readonly labels?: RawNodeList<RawIdRef>;
  readonly project?: RawIdRef | null;
  readonly cycle?: RawIdRef | null;
  readonly parent?: RawIdRef | null;
  readonly team?: RawIdRef | null;
}

/**
 * Map a raw Linear `User` node onto an {@link ExternalUser}.
 *
 * @remarks
 * `displayName` is preferred; `name` is used only when the API omits `displayName` — a
 * data-shape accommodation for older payloads, not a configured default. A user with neither
 * fails the sync rather than being given a placeholder name.
 */
export function toExternalUser(node: RawUserNode): ExternalUser {
  const displayName = node.displayName ?? node.name;
  if (displayName === undefined) throw mappingError(`user ${node.id} has no name`);
  return {
    externalId: node.id,
    displayName,
    ...(node.email != null ? { email: node.email } : {}),
    ...(node.avatarUrl != null ? { avatarUrl: node.avatarUrl } : {}),
    active: node.active,
  };
}

/** Map a raw Linear `IssueLabel` node onto an {@link ExternalLabel} (team id only when team-scoped). */
export function toExternalLabel(node: RawLabelNode): ExternalLabel {
  return {
    externalId: node.id,
    name: node.name,
    color: node.color,
    ...(node.team != null ? { externalTeamId: node.team.id } : {}),
  };
}

/** Map a raw Linear `Project` node onto an {@link ExternalProject} (`removed` = archived). */
export function toExternalProject(node: RawProjectNode): ExternalProject {
  return {
    externalId: node.id,
    name: node.name,
    ...(node.description != null ? { description: node.description } : {}),
    state: mapLinearProjectState(node.state),
    ...(node.lead != null ? { leadExternalId: node.lead.id } : {}),
    ...(node.startDate != null ? { startDate: node.startDate } : {}),
    ...(node.targetDate != null ? { targetDate: node.targetDate } : {}),
    url: node.url,
    updatedAt: node.updatedAt,
    ...(node.archivedAt != null ? { removed: true } : {}),
    externalTeamIds: (node.teams?.nodes ?? []).map((t) => t.id),
  };
}

/** Map a raw Linear `Cycle` node onto an {@link ExternalCycle} (a cycle always belongs to a team). */
export function toExternalCycle(node: RawCycleNode): ExternalCycle {
  const externalTeamId = node.team?.id;
  if (externalTeamId === undefined) throw mappingError(`cycle ${node.id} has no team`);
  return {
    externalId: node.id,
    externalTeamId,
    number: node.number,
    ...(node.name != null ? { name: node.name } : {}),
    startsAt: node.startsAt,
    endsAt: node.endsAt,
    ...(node.completedAt != null ? { completedAt: node.completedAt } : {}),
    updatedAt: node.updatedAt,
  };
}

/** Map a raw Linear `WorkflowState` node onto an {@link ExternalWorkflowState}. */
export function toExternalWorkflowState(node: RawStateNode): ExternalWorkflowState {
  return {
    externalId: node.id,
    name: node.name,
    type: mapLinearStateType(node.type),
    position: node.position,
  };
}

/**
 * Map a raw Linear `Issue` node onto an {@link ExternalWorkItem}.
 *
 * @remarks
 * `removed` is a tombstone derived from `archivedAt` OR `trashed` — either marks the issue as
 * no-longer-live content. The item's `externalId` is the UUID, never the `identifier`.
 */
export function toExternalWorkItem(node: RawIssueNode): ExternalWorkItem {
  const externalTeamId = node.team?.id;
  if (externalTeamId === undefined) throw mappingError(`issue ${node.id} has no team`);
  const removed = node.archivedAt != null || node.trashed === true;
  return {
    externalId: node.id,
    identifier: node.identifier,
    title: node.title,
    ...(node.description != null ? { description: node.description } : {}),
    stateType: mapLinearStateType(node.state.type),
    stateName: node.state.name,
    priority: mapLinearPriority(node.priority),
    ...(node.assignee != null ? { assigneeExternalId: node.assignee.id } : {}),
    labelExternalIds: (node.labels?.nodes ?? []).map((l) => l.id),
    ...(node.project != null ? { projectExternalId: node.project.id } : {}),
    ...(node.cycle != null ? { cycleExternalId: node.cycle.id } : {}),
    ...(node.parent != null ? { parentExternalId: node.parent.id } : {}),
    externalTeamId,
    ...(node.estimate != null ? { estimate: node.estimate } : {}),
    ...(node.dueDate != null ? { dueDate: node.dueDate } : {}),
    ...(node.startedAt != null ? { startedAt: node.startedAt } : {}),
    ...(node.completedAt != null ? { completedAt: node.completedAt } : {}),
    ...(node.canceledAt != null ? { canceledAt: node.canceledAt } : {}),
    url: node.url,
    updatedAt: node.updatedAt,
    ...(removed ? { removed: true } : {}),
  };
}

/** A Linear GraphQL envelope: the typed `data` payload, plus any `errors[]`. */
interface GraphQLResponse<T> {
  readonly data?: T;
  readonly errors?: { readonly message: string }[];
}

/** The `viewer` + `organization` identity query used at verify time. */
const VIEWER_QUERY = '{ viewer { id name email } organization { id urlKey } }';

/** Teams (containers) query — `first`/`after` paginated by GraphQL variable. */
const TEAMS_QUERY =
  'query($after: String) { teams(first: 100, after: $after) { nodes { id name key } pageInfo { hasNextPage endCursor } } }';

/** A single team's ordered workflow states (unpaginated — a team has a bounded set). */
const TEAM_STATES_QUERY =
  'query($id: String!) { team(id: $id) { states { nodes { id name type position } } } }';

/** Workspace users query (includes deactivated members so they still resolve as assignees). */
const USERS_QUERY =
  'query($after: String) { users(first: 100, after: $after, includeDisabled: true) { nodes { id name displayName email avatarUrl active } pageInfo { hasNextPage endCursor } } }';

/** Workspace + team labels query. */
const LABELS_QUERY =
  'query($after: String) { issueLabels(first: 100, after: $after) { nodes { id name color team { id } } pageInfo { hasNextPage endCursor } } }';

/** Projects query (archived included so tombstones are pulled; team ids for client-side scoping). */
const PROJECTS_QUERY =
  'query($after: String) { projects(first: 100, after: $after, includeArchived: true) { nodes { id name description state url startDate targetDate archivedAt updatedAt lead { id } teams(first: 50) { nodes { id } } } pageInfo { hasNextPage endCursor } } }';

/** The rich issues query — `$filter` composes team scope and/or the incremental `updatedAt` cutoff. */
const ISSUES_QUERY = `query($after: String, $filter: IssueFilter) {
  issues(first: 100, after: $after, includeArchived: true, filter: $filter) {
    nodes {
      id identifier title description url priority estimate dueDate
      startedAt completedAt canceledAt archivedAt trashed updatedAt
      state { id name type }
      assignee { id }
      labels(first: 50) { nodes { id } }
      project { id } cycle { id } parent { id } team { id }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** The lightweight issues query backing legacy `importWork`/`mirrorStatus` (identifier + display only). */
const IMPORT_ISSUES_QUERY =
  'query($after: String) { issues(first: 100, after: $after) { nodes { id identifier title description url } pageInfo { hasNextPage endCursor } } }';

/** Build the cycles query, adding the team filter (and its variable) only when the pull is scoped. */
function cyclesQuery(scoped: boolean): string {
  const decl = scoped ? '$after: String, $teamIds: [ID!]' : '$after: String';
  const filter = scoped ? ', filter: { team: { id: { in: $teamIds } } }' : '';
  return `query(${decl}) { cycles(first: 100, after: $after${filter}) { nodes { id number name startsAt endsAt completedAt updatedAt team { id } } pageInfo { hasNextPage endCursor } } }`;
}

/**
 * The Linear connector client (GraphQL).
 *
 * @remarks
 * Implements the full {@link WorkGraphProviderClient}: `resolveAccount` runs the viewer +
 * organization query (resolving the workspace id/slug used for webhook routing); `pullWorkGraph`
 * runs the rich paginated pull of users/labels/projects/cycles/issues; `listTeamStates` reads a
 * team's workflow; `pushWorkItem` runs `issueUpdate`/`issueCreate`. Legacy `importWork`/
 * `mirrorStatus` remain for the read-only mirror path. Every call is a single `POST /graphql`
 * with a `Bearer` token and GraphQL **variables** (never string-interpolated cursors).
 */
export class LinearProviderClient implements WorkGraphProviderClient {
  /** @param http - The provider HTTP wrapper bound to Linear. */
  constructor(private readonly http: ProviderHttp) {}

  /**
   * Run one GraphQL operation with optional variables and return its `data` payload.
   *
   * @remarks
   * Linear can answer a 200 with a populated `errors[]` (e.g. an expired token surfaces as an
   * "authentication"/"access" GraphQL error rather than a 401), so these are raised as typed
   * {@link ConnectorError}s — auth-shaped messages become `auth` (re-auth needed) and the rest
   * `provider` — instead of a generic untyped throw the caller can't reason about.
   */
  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const body = variables !== undefined ? { query, variables } : { query };
    const json = await this.http.postJson<GraphQLResponse<T>>('/graphql', body);
    if (json.errors && json.errors.length > 0) {
      const message = json.errors.map((e) => e.message).join('; ');
      const kind = /auth|unauthorized|access|token|forbidden/i.test(message) ? 'auth' : 'provider';
      throw new ConnectorError(`linear GraphQL error: ${message}`, { provider: 'linear', kind });
    }
    if (json.data === undefined) {
      throw new ConnectorError('linear GraphQL response missing data', {
        provider: 'linear',
        kind: 'provider',
      });
    }
    return json.data;
  }

  /**
   * Fetch every page of one Linear connection via cursor pagination, warning if the safety
   * bound truncates results.
   *
   * @param resource - The GraphQL field name (also the truncation-log resource label).
   * @param query - The paginated query; its cursor is passed as the `$after` variable.
   * @param variables - Query variables other than the cursor (merged into every page request).
   */
  private async paginate<N>(
    resource: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<N[]> {
    const all: N[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (let page = 0; page < MAX_IMPORT_PAGES; page++) {
      const data = await this.query<Record<string, RawConnection<N>>>(query, {
        ...variables,
        ...(cursor !== undefined ? { after: cursor } : {}),
      });
      const conn = data[resource];
      all.push(...(conn?.nodes ?? []));
      const pageInfo = conn?.pageInfo;
      if (pageInfo?.hasNextPage !== true || pageInfo.endCursor === undefined) break;
      cursor = pageInfo.endCursor;
      if (page === MAX_IMPORT_PAGES - 1) truncated = true;
    }
    if (truncated) {
      logConnectorTruncation({
        provider: 'linear',
        resource,
        fetched: all.length,
        maxPages: MAX_IMPORT_PAGES,
      });
    }
    return all;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.resolveAccount}
   *
   * @remarks
   * Resolves the viewer label (name, falling back to email) plus the organization's
   * `externalWorkspaceId` (webhook routing key) and `externalWorkspaceSlug` (`urlKey`).
   */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const data = await this.query<{
      viewer?: { name?: string; email?: string };
      organization?: { id?: string; urlKey?: string };
    }>(VIEWER_QUERY);
    const label = data.viewer?.name ?? data.viewer?.email;
    if (label === undefined) return undefined;
    return {
      label,
      ...(data.organization?.id != null ? { externalWorkspaceId: data.organization.id } : {}),
      ...(data.organization?.urlKey != null
        ? { externalWorkspaceSlug: data.organization.urlKey }
        : {}),
    };
  }

  /**
   * Map a raw legacy issue node onto an {@link ImportedItem}.
   *
   * @remarks
   * `provenance.externalId` is the Linear issue **UUID** (`node.id`) — the stable sync key —
   * not the human `identifier`.
   */
  private toImportedItem(node: RawIssueNode, importedAt: string): ImportedItem {
    return {
      id: node.id,
      kind: 'issue',
      title: node.title,
      ...(node.description != null ? { body: node.description } : {}),
      provenance: {
        provider: 'linear',
        externalId: node.id,
        externalUrl: node.url,
        importedAt,
      },
    };
  }

  /** Fetch all Linear issues (lightweight legacy shape) for the read-only mirror path. */
  private async fetchImportIssues(): Promise<RawIssueNode[]> {
    return this.paginate<RawIssueNode>('issues', IMPORT_ISSUES_QUERY, {});
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const nodes = await this.fetchImportIssues();
    return nodes.map((node) => this.toImportedItem(node, importedAt));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const nodes = await this.fetchImportIssues();
    return { connectionId: input.connectionId, status: 'idle', itemCount: nodes.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    const match = /^([^/]+)\/([A-Z0-9]+-\d+)$/.exec(input.externalId);
    if (!match) return undefined;
    return `https://linear.app/${match[1]}/issue/${match[2]}`;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.listContainers}
   *
   * @remarks
   * A Linear "container" is a team — the unit a work-graph pull is scoped to.
   */
  async listContainers(): Promise<ResourceRef[]> {
    const teams = await this.paginate<{ id: string; name: string; key: string }>(
      'teams',
      TEAMS_QUERY,
      {},
    );
    return teams.map((team) => ({ id: team.id, title: team.name }));
  }

  /** {@inheritDoc WorkGraphConnector.listTeamStates} */
  async listTeamStates(externalTeamId: string): Promise<ExternalWorkflowState[]> {
    const data = await this.query<{ team?: { states?: RawNodeList<RawStateNode> } }>(
      TEAM_STATES_QUERY,
      { id: externalTeamId },
    );
    const nodes = data.team?.states?.nodes ?? [];
    return nodes.map(toExternalWorkflowState).sort((a, b) => a.position - b.position);
  }

  /** Pull every workspace user (small collection — always pulled whole). */
  private async fetchUsers(): Promise<ExternalUser[]> {
    const nodes = await this.paginate<RawUserNode>('users', USERS_QUERY, {});
    return nodes.map(toExternalUser);
  }

  /** Pull every workspace/team label (small collection — always pulled whole). */
  private async fetchLabels(): Promise<ExternalLabel[]> {
    const nodes = await this.paginate<RawLabelNode>('issueLabels', LABELS_QUERY, {});
    return nodes.map(toExternalLabel);
  }

  /**
   * Pull every project, then client-side scope to the selected teams.
   *
   * @remarks
   * Project↔team is many-to-many, so a project is in scope when its team set intersects the
   * selection; an empty selection means every project. Linear's project query cannot filter by
   * team server-side, so the scoping happens here.
   */
  private async fetchProjects(externalTeamIds: readonly string[]): Promise<ExternalProject[]> {
    const nodes = await this.paginate<RawProjectNode>('projects', PROJECTS_QUERY, {});
    const projects = nodes.map(toExternalProject);
    if (externalTeamIds.length === 0) return projects;
    const selected = new Set(externalTeamIds);
    return projects.filter((project) => project.externalTeamIds.some((id) => selected.has(id)));
  }

  /** Pull every cycle, scoping to the selected teams server-side when the selection is non-empty. */
  private async fetchCycles(externalTeamIds: readonly string[]): Promise<ExternalCycle[]> {
    const scoped = externalTeamIds.length > 0;
    const nodes = await this.paginate<RawCycleNode>(
      'cycles',
      cyclesQuery(scoped),
      scoped ? { teamIds: externalTeamIds } : {},
    );
    return nodes.map(toExternalCycle);
  }

  /**
   * Pull every issue matching the composed filter.
   *
   * @remarks
   * `$filter` composes a `team` scope (when teams are selected) AND an `updatedAt` cutoff (when
   * incremental) — the filter variable is omitted entirely when neither applies.
   */
  private async fetchWorkItems(
    externalTeamIds: readonly string[],
    updatedAfter: string | undefined,
  ): Promise<ExternalWorkItem[]> {
    const filter: {
      team?: { id: { in: readonly string[] } };
      updatedAt?: { gt: string };
    } = {};
    if (externalTeamIds.length > 0) filter.team = { id: { in: externalTeamIds } };
    if (updatedAfter !== undefined) filter.updatedAt = { gt: updatedAfter };
    const variables = Object.keys(filter).length > 0 ? { filter } : {};
    const nodes = await this.paginate<RawIssueNode>('issues', ISSUES_QUERY, variables);
    return nodes.map(toExternalWorkItem);
  }

  /**
   * {@inheritDoc WorkGraphConnector.pullWorkGraph}
   *
   * @remarks
   * The incremental `updatedAfter` cutoff narrows only the ISSUES pull — the single expensive
   * collection. Users, labels, projects, and cycles are small and cheap, so they are always
   * pulled in full to keep the mirror internally consistent (a renamed label or reassigned
   * project must never be missed because it was untouched since the last cutoff).
   */
  async pullWorkGraph(input: PullWorkGraphInput): Promise<WorkGraphSnapshot> {
    const users = await this.fetchUsers();
    const labels = await this.fetchLabels();
    const projects = await this.fetchProjects(input.externalTeamIds);
    const cycles = await this.fetchCycles(input.externalTeamIds);
    const items = await this.fetchWorkItems(input.externalTeamIds, input.updatedAfter);
    return { users, labels, projects, cycles, items };
  }

  /**
   * Build a Linear `IssueUpdateInput`/`IssueCreateInput` from the fields present on a push.
   *
   * @remarks
   * A field absent from {@link WorkItemPushFields} is left untouched (never sent); an explicit
   * `null` on a nullable field is sent verbatim to CLEAR it at Linear (unassign, drop the due
   * date/estimate). Presence is decided by `!== undefined` so `null` is preserved.
   */
  private buildIssueInput(fields: WorkItemPushFields): LinearIssueInputBody {
    const input: LinearIssueInputBody = {};
    if (fields.title !== undefined) input.title = fields.title;
    if (fields.description !== undefined) input.description = fields.description;
    if (fields.stateExternalId !== undefined) input.stateId = fields.stateExternalId;
    if (fields.priority !== undefined) input.priority = toLinearPriority(fields.priority);
    if (fields.assigneeExternalId !== undefined) input.assigneeId = fields.assigneeExternalId;
    if (fields.dueDate !== undefined) input.dueDate = fields.dueDate;
    if (fields.estimate !== undefined) input.estimate = fields.estimate;
    if (fields.labelExternalIds !== undefined) input.labelIds = fields.labelExternalIds;
    return input;
  }

  /** Interpret a mutation payload, turning a `success: false`/missing issue into a typed failure. */
  private toWriteResult(
    field: string,
    payload:
      | { success?: boolean; issue?: { id: string; updatedAt: string; url?: string } }
      | undefined,
  ): ExternalWriteResult {
    if (payload?.success !== true || payload.issue === undefined) {
      throw new ConnectorError(`linear ${field} did not succeed`, {
        provider: 'linear',
        kind: 'provider',
      });
    }
    return {
      externalId: payload.issue.id,
      externalUpdatedAt: payload.issue.updatedAt,
    };
  }

  /** {@inheritDoc WorkGraphConnector.pushWorkItem} */
  async pushWorkItem(op: WorkItemPushOp): Promise<ExternalWriteResult> {
    if (op.kind === 'update') {
      const data = await this.query<{
        issueUpdate?: { success?: boolean; issue?: { id: string; updatedAt: string } };
      }>(
        'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id updatedAt } } }',
        { id: op.externalId, input: this.buildIssueInput(op.fields) },
      );
      return this.toWriteResult('issueUpdate', data.issueUpdate);
    }
    const data = await this.query<{
      issueCreate?: { success?: boolean; issue?: { id: string; updatedAt: string; url: string } };
    }>(
      'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id updatedAt url } } }',
      { input: { teamId: op.externalTeamId, ...this.buildIssueInput(op.fields) } },
    );
    return this.toWriteResult('issueCreate', data.issueCreate);
  }
}
