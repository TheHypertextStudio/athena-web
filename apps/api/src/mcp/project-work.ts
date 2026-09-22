/**
 * `@docket/api` — a project's work, shaped for a card that has to show a hundred tasks well.
 *
 * @remarks
 * A project read used to carry its first four tasks by due date and a total count. That shows one
 * fragment of a big project and hides its shape. This gives the card two things:
 * - how the work divides across the board's states;
 * - the few open tasks worth seeing first (in progress, then not started, then backlog, soonest due
 *   first).
 *
 * It also builds the browsable list itself, {@link ProjectWorkIndex}, from the same rows. That travels
 * in the result's `_meta`, where the model never reads it, so a card can filter and search a large
 * project without another call.
 */
import type { WorkflowStateType } from '../contracts/team';
import { statefulRef, type StatefulTaskRef, type TaskRefSource } from './hydrated-refs';
import { teamWorkflows, type TeamWorkflows } from './workflow-states';

/** The task columns project work is built from. */
export interface ProjectTaskSource extends TaskRefSource {
  readonly milestoneId: string | null;
  readonly dueDate: Date | null;
  /** The assignee's display name. */
  readonly assignee: string | null;
}

/** How a project's visible work divides across the board's states. */
export interface WorkSummary {
  readonly total: number;
  readonly open: number;
  readonly byType: Readonly<Record<WorkflowStateType | 'unknown', number>>;
}

/** An open task worth seeing first, with its due day. */
export type OpenTaskRef = StatefulTaskRef & { readonly dueDate: string | null };

/** What a project read carries about its work. */
export interface ProjectWork {
  readonly summary: WorkSummary;
  readonly next: readonly OpenTaskRef[];
  /** Every visible task to browse, for the card only. */
  readonly index: ProjectWorkIndex;
}

/** How many open tasks a card leads with. */
const LEAD_TASKS = 5;

/** The most tasks one card carries to browse; past this the card sends the reader to Docket. */
const INDEX_LIMIT = 200;

/** Board order for open work. Anything closed or unresolved sorts after it. */
const OPEN_RANK: Readonly<Record<string, number>> = { started: 0, unstarted: 1, backlog: 2 };

const isClosed = (type: WorkflowStateType | null): boolean =>
  type === 'completed' || type === 'canceled';

const rankOf = (type: WorkflowStateType | null): number => OPEN_RANK[type ?? ''] ?? 3;

const isoDay = (date: Date | null): string | null => date?.toISOString().slice(0, 10) ?? null;

/** What work is ordered by. */
interface Orderable {
  readonly stateType: WorkflowStateType | null;
  readonly dueDate: string | null;
  readonly title: string;
}

/** Board order first, then the soonest due, then by title so ties read the same every time. */
function workOrder(a: Orderable, b: Orderable): number {
  const rank = rankOf(a.stateType) - rankOf(b.stateType);
  if (rank !== 0) return rank;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.title.localeCompare(b.title);
}

/** Count each row's state type. */
function summaryOf(types: readonly (WorkflowStateType | null)[]): WorkSummary {
  const byType = { backlog: 0, unstarted: 0, started: 0, completed: 0, canceled: 0, unknown: 0 };
  for (const type of types) byType[type ?? 'unknown'] += 1;
  const open = types.filter((type) => !isClosed(type)).length;
  return { total: types.length, open, byType };
}

/**
 * Shape a project's visible tasks for its card.
 *
 * @param orgId - The organization the project belongs to.
 * @param rows - The project's tasks, already filtered to what the caller may see.
 * @returns The state summary, the open tasks to lead with, and the browsable index.
 */
export async function projectWorkOf(
  orgId: string,
  rows: readonly ProjectTaskSource[],
): Promise<ProjectWork> {
  const workflows = await teamWorkflows(
    orgId,
    rows.map((row) => row.teamId).filter((teamId): teamId is string => teamId !== null),
  );
  const index = rows.map((row) => indexed(orgId, row, workflows)).sort(workOrder);
  const refs = rows.map((row) => ({
    ...statefulRef(orgId, row, workflows),
    dueDate: isoDay(row.dueDate),
  }));
  const next = refs
    .filter((ref) => !isClosed(ref.stateType))
    .sort(workOrder)
    .slice(0, LEAD_TASKS);
  return {
    summary: summaryOf(refs.map((ref) => ref.stateType)),
    next,
    index: { tasks: index.slice(0, INDEX_LIMIT), total: index.length },
  };
}

/** One task in a project's browsable index. */
export interface IndexedTask {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly stateType: WorkflowStateType | null;
  readonly stateName: string | null;
  readonly milestoneId: string | null;
  readonly dueDate: string | null;
  readonly assignee: string | null;
}

/** A project's work, ready for a card to browse. */
export interface ProjectWorkIndex {
  readonly tasks: readonly IndexedTask[];
  /** How many visible tasks the project has, including any past {@link INDEX_LIMIT}. */
  readonly total: number;
}

/** One index row from a task and the workflows of its team. */
function indexed(orgId: string, row: ProjectTaskSource, workflows: TeamWorkflows): IndexedTask {
  const ref = statefulRef(orgId, row, workflows);
  return {
    id: ref.id,
    title: ref.title,
    href: ref.href,
    stateType: ref.stateType,
    stateName: ref.stateName,
    milestoneId: row.milestoneId,
    dueDate: isoDay(row.dueDate),
    assignee: row.assignee,
  };
}
