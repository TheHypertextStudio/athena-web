/**
 * `athena` — plain-language descriptions of one pending proposal, for the batch-review card.
 *
 * @remarks
 * `ProposalItemOut.tool` and `.input` are the raw shape a tool call executes with (`update_task`,
 * `{ taskId, state: 'in_progress' }`) — exactly what a reviewer should never have to read. This
 * module is the one place that turns that shape into a sentence a person can approve on sight,
 * so nothing else in the review surface reaches for `item.tool` directly.
 */
import type { ProposalItemOut } from '@docket/athena/agent-contract';
import { DEFAULT_WORK_STATUSES } from '@docket/work/work-status-contract';

/**
 * Default task-status labels, keyed by the seed status key an agent proposes into `state`.
 *
 * @remarks
 * A workspace can rename or replace its own status set, and this module has no access to that
 * registry — it only ever sees the raw proposed value. These are the seed keys every workspace
 * starts from ({@link DEFAULT_WORK_STATUSES}), read from there rather than duplicated, so a status
 * key this module hasn't seen still falls back to {@link humanizeKey} instead of a blank label.
 */
const TASK_STATUS_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_WORK_STATUSES.task.map((status) => [status.key, status.name] as const),
);

/** The `update_task` input fields this module can describe, in the order their sentences join. */
const UPDATE_TASK_FIELD_ORDER = [
  'state',
  'title',
  'dueDate',
  'assigneeId',
  'teamId',
  'projectId',
] as const;

/** One recognized `update_task` field name. */
type UpdateTaskField = (typeof UPDATE_TASK_FIELD_ORDER)[number];

/** The plain-English noun for each ownership field a task can move to. */
const OWNER_FIELD_NOUN: Readonly<Record<'assigneeId' | 'teamId' | 'projectId', string>> = {
  assigneeId: 'assignee',
  teamId: 'team',
  projectId: 'project',
};

/** Read a value as a non-empty string, or `undefined` when it isn't one. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Turn a `snake_case` key into `Title Case` words, for a status this module hasn't seen. */
function humanizeKey(key: string): string {
  return key
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

/** The label for a proposed task state: its workspace-default name, or the raw key in words. */
function stateLabel(value: unknown): string {
  const raw = asString(value);
  if (raw === undefined) return String(value);
  return TASK_STATUS_LABELS[raw] ?? humanizeKey(raw);
}

/** One sentence fragment per `update_task` field, keyed by field name. */
const UPDATE_TASK_DESCRIBERS: Readonly<Record<UpdateTaskField, (value: unknown) => string>> = {
  state: (value) => `Set state to ${stateLabel(value)}`,
  title: (value) => `Rename to "${asString(value) ?? String(value)}"`,
  dueDate: (value) => `Due ${asString(value) ?? String(value)}`,
  assigneeId: () => `Move to another ${OWNER_FIELD_NOUN.assigneeId}`,
  teamId: () => `Move to another ${OWNER_FIELD_NOUN.teamId}`,
  projectId: () => `Move to another ${OWNER_FIELD_NOUN.projectId}`,
};

/**
 * Capitalise a string's first letter, leaving the rest exactly as written.
 *
 * @param value - The string to capitalise.
 * @returns `value` with its first character upper-cased; `value` unchanged when empty.
 */
export function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * One changed-field sentence per recognized key present on an `update_task` proposal's input.
 *
 * @param input - The proposed tool input.
 * @returns the sentence fragments in {@link UPDATE_TASK_FIELD_ORDER}; empty when the input carries
 * none of the recognized fields (e.g. only the target `taskId`).
 */
function describeTaskFieldChanges(input: Readonly<Record<string, unknown>>): readonly string[] {
  return UPDATE_TASK_FIELD_ORDER.filter((field) => field in input).map((field) =>
    UPDATE_TASK_DESCRIBERS[field](input[field]),
  );
}

/**
 * Describe one pending proposal in plain language, for the batch-review card.
 *
 * @remarks
 * Never renders {@link ProposalItemOut.tool} — the raw tool identifier a reviewer should never
 * have to read. `create_task` names the task being created; `update_task` lists what changed, in
 * {@link UPDATE_TASK_FIELD_ORDER} order, joined with ` · `; every other tool, and an `update_task`
 * whose input carries none of the recognized fields, falls back to the proposal's own
 * {@link ProposalItemOut.summary}, capitalised.
 *
 * @param item - The proposal to describe.
 * @returns a one-line (occasionally two-clause) plain-English sentence.
 *
 * @example
 * ```ts
 * describeProposal({ tool: 'update_task', input: { state: 'in_progress' }, … });
 * // 'Set state to In Progress'
 * ```
 */
export function describeProposal(item: ProposalItemOut): string {
  if (item.tool === 'create_task') {
    const title = item.ghost?.title ?? asString(item.input['title']) ?? item.summary;
    return `Create "${title}"`;
  }
  if (item.tool === 'update_task') {
    const changes = describeTaskFieldChanges(item.input);
    return changes.length > 0 ? changes.join(' · ') : capitalizeFirst(item.summary);
  }
  return capitalizeFirst(item.summary);
}
