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
 * A tool name whose call leaves Docket — a message sent, an invitation issued, a charge run —
 * rather than only changing a record this workspace already owns.
 *
 * @remarks
 * Docket's own writes (`create_task`, `update_task`, …) are reversible through the change-set
 * ledger, which is what makes Approve-with-Undo the right decision shape for them. A tool that
 * hands something to the outside world cannot be undone once it runs, so it earns the slower
 * Review-before-Approve shape instead — see §4.6 of the companion design.
 */
export function isOutwardTool(tool: string): boolean {
  return /send|post|publish|mail|email|invite|pay|charge/i.test(tool);
}

/** One label/value row of an outward proposal's raw input, for the Review expansion. */
export interface ProposalInputRow {
  readonly label: string;
  readonly value: string;
}

/** Fields shown first in an outward proposal's Review expansion, ahead of anything else it carries. */
const OUTWARD_FIELD_PRIORITY = ['to', 'subject', 'body'] as const;

/** Render one input value as review-page text: a string as itself, anything else as JSON. */
function describeInputValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Order one outward proposal's raw input as label/value rows for the Review expansion.
 *
 * @remarks
 * `to`, `subject`, and `body` lead when present — the fields a reviewer most needs before
 * approving something that leaves Docket — followed by every other field in the order the tool
 * call carried it.
 *
 * @param input - The proposed tool input.
 * @returns the rows in display order.
 */
export function orderedInputRows(
  input: Readonly<Record<string, unknown>>,
): readonly ProposalInputRow[] {
  const seen = new Set<string>();
  const rows: ProposalInputRow[] = [];
  for (const field of OUTWARD_FIELD_PRIORITY) {
    if (!(field in input)) continue;
    rows.push({ label: field, value: describeInputValue(input[field]) });
    seen.add(field);
  }
  for (const [key, value] of Object.entries(input)) {
    if (seen.has(key)) continue;
    rows.push({ label: key, value: describeInputValue(value) });
  }
  return rows;
}

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

/** The pieces of a work-log tool activity {@link describeToolActivity} needs. */
export interface ToolActivityLike {
  /** The humanised action Athena reported, e.g. `"update task"`. */
  readonly action: string;
  /** The raw tool call, when the activity carried one through. */
  readonly technical?:
    | {
        readonly toolName?: string | undefined;
        readonly input?: unknown;
      }
    | undefined;
}

/**
 * Describe one work-log tool activity in plain language, for the same row `describeProposal`
 * feeds the batch-review card.
 *
 * @remarks
 * Reuses {@link UPDATE_TASK_DESCRIBERS} — the same field-to-words mapping `describeProposal` reads
 * — whenever the activity carried its raw tool call through (`technical.toolName` +
 * `technical.input`), so a row and its originating proposal describe the same change the same way
 * (`update_task` + `{ state: 'in_progress' }` → `"Set state to In Progress"`). Every other
 * activity — no raw call, or a tool this module does not recognize — falls back to the reported
 * action, capitalised (`"update task"` → `"Update task"`), which is still a sentence and not the
 * tool's machine name.
 *
 * @param activity - The work-log activity to describe.
 * @returns a one-line plain-English sentence.
 */
export function describeToolActivity(activity: ToolActivityLike): string {
  const toolName = activity.technical?.toolName;
  const input = activity.technical?.input;
  if (toolName !== undefined && typeof input === 'object' && input !== null) {
    const record = input as Readonly<Record<string, unknown>>;
    if (toolName === 'create_task') {
      const title = asString(record['title']);
      if (title !== undefined) return `Create "${title}"`;
    }
    if (toolName === 'update_task') {
      const changes = describeTaskFieldChanges(record);
      if (changes.length > 0) return changes.join(' · ');
    }
  }
  return capitalizeFirst(activity.action);
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
