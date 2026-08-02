/**
 * `@docket/api` — the task metadata activity ledger.
 *
 * @remarks
 * A task's activity log answers "who changed what, and when" — the question a GitHub issue's
 * event log or Sunsama's task history answers. Docket already has exactly one table designed for
 * that question: `audit_event`, the compliance ledger keyed by `(subjectType, subjectId)`. This
 * module is the only writer of task-subject rows into it, so the log's shape can never diverge
 * between the PATCH route, the state route, and the automation engine.
 *
 * Two deliberate choices are worth stating.
 *
 * **We do not emit onto the `event` stream.** `docs/engineering/specs/activity-feed.md` reserves
 * `event` for the cross-tool awareness feed; one `event` per changed field would fan out
 * notifications, SSE pushes, automation runs, and search reindex jobs per field, and several
 * fields changing inside a single PATCH would collide on `event-emit`'s millisecond-resolution
 * dedupe key. The ledger is the right substrate; the stream keeps doing its own job untouched.
 *
 * **Values are resolved to display strings at write time.** A change entry stores "Website
 * redesign", not a project id. History must be immutable — renaming that project next month must
 * not retroactively rewrite what the log says happened today — and the reader must never have to
 * resolve an id it may no longer be able to see. The cost is one small batch of lookups per
 * mutation, paid once, on the write.
 */
import { actor, auditEvent, cycle, db, genId, milestone, program, project, task } from '@docket/db';
import { defaultCycleName, type TaskActivityChange } from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';

import type { TaskRow } from '../routes/task-helpers';

/**
 * How a tracked field's raw column value becomes a display string.
 *
 * @remarks
 * The reference kinds (`actor`/`project`/…) name the table a batch lookup must hit; the value
 * kinds are formatted without touching the database at all.
 */
type TaskAuditFieldKind =
  | 'text'
  | 'enum'
  | 'date'
  | 'number'
  | 'actor'
  | 'project'
  | 'program'
  | 'milestone'
  | 'cycle'
  | 'task';

/** One tracked task field: its stable machine key, its display label, and how to render it. */
export interface TaskAuditField {
  /** Stable machine key, matching the `task` column name (e.g. `assigneeId`). Never rendered. */
  readonly field: keyof TaskRow;
  /** Application-owned display label (e.g. "Anticipated start"). Never a column name. */
  readonly label: string;
  /** How the raw value is turned into a display string. */
  readonly kind: TaskAuditFieldKind;
}

/**
 * The task fields whose changes are recorded on the activity log, in log-entry order.
 *
 * @remarks
 * Labels are application-owned copy, chosen for the reader rather than lifted from the schema —
 * `startDate` reads as "Anticipated start" because that is what the product calls it, and
 * `estimateMinutes` reads as "Time estimate" to separate it from the point `estimate`. The
 * project label is the plain word "Project": per-org vocabulary skinning is a presentation
 * concern applied when the log is read, not a value frozen into the ledger.
 *
 * Ordering matters: when one PATCH changes several fields, entries are written in this order, so
 * a multi-field edit always reads the same way.
 */
export const TASK_AUDIT_FIELDS: readonly TaskAuditField[] = [
  { field: 'title', label: 'Title', kind: 'text' },
  { field: 'description', label: 'Description', kind: 'text' },
  { field: 'state', label: 'Status', kind: 'enum' },
  { field: 'priority', label: 'Priority', kind: 'enum' },
  { field: 'assigneeId', label: 'Assignee', kind: 'actor' },
  { field: 'delegateId', label: 'Delegate', kind: 'actor' },
  { field: 'projectId', label: 'Project', kind: 'project' },
  { field: 'programId', label: 'Program', kind: 'program' },
  { field: 'milestoneId', label: 'Milestone', kind: 'milestone' },
  { field: 'cycleId', label: 'Cycle', kind: 'cycle' },
  { field: 'parentTaskId', label: 'Parent task', kind: 'task' },
  { field: 'estimate', label: 'Estimate', kind: 'number' },
  { field: 'estimateMinutes', label: 'Time estimate', kind: 'number' },
  { field: 'startDate', label: 'Anticipated start', kind: 'date' },
  { field: 'dueDate', label: 'Due date', kind: 'date' },
];

/** One detected field change, before its values have been resolved to display strings. */
export interface TaskFieldDiff {
  /** The stable machine key of the changed field. */
  readonly field: string;
  /** The application-owned display label for the field. */
  readonly label: string;
  /** The raw column value before the change. */
  readonly fromRaw: unknown;
  /** The raw column value after the change. */
  readonly toRaw: unknown;
}

/** Longest description excerpt stored in a change entry before it is elided. */
const DESCRIPTION_EXCERPT_LIMIT = 140;

/** Fallback display value for a reference whose target row can no longer be read. */
const UNRESOLVED_REFERENCE = 'Unknown';

/**
 * Narrow a raw column value to its scalar text form.
 *
 * @remarks
 * Every tracked column is a string, an integer, a timestamp, or null; anything else would be a
 * schema change this module has not been taught about, and is treated as unset rather than
 * stringified into `[object Object]` in someone's history.
 */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Project a timestamp column onto its calendar day, the granularity these fields mean. */
function dayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = scalarText(value);
  const date = value instanceof Date ? value : text === null ? null : new Date(text);
  if (date === null || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Compare one field's before/after values for a real change.
 *
 * @remarks
 * Date columns are compared by their `YYYY-MM-DD` slice, never by `Date` identity: two `Date`
 * objects for the same day are different values in JavaScript, and a due date "changing" from
 * a day to the same day would write a meaningless entry on every save. `null` and `undefined`
 * both mean unset and must not read as a change relative to each other.
 */
function hasChanged(kind: TaskAuditFieldKind, before: unknown, after: unknown): boolean {
  if (kind === 'date') return dayOf(before) !== dayOf(after);
  const a = before ?? null;
  const b = after ?? null;
  return a !== b;
}

/**
 * Diff two versions of a task row into the field changes worth recording.
 *
 * @remarks
 * Only fields in {@link TASK_AUDIT_FIELDS} are considered, and only fields whose value actually
 * moved produce an entry — a PATCH that re-sends a field's current value, or an empty PATCH,
 * writes nothing. That is what keeps the log a history of changes rather than a history of
 * requests.
 *
 * @param before - The task row as it was before the mutation.
 * @param after - The task row as returned by the mutation.
 * @returns one {@link TaskFieldDiff} per changed field, in {@link TASK_AUDIT_FIELDS} order.
 *
 * @example
 * ```ts
 * diffTaskFields(before, after); // [{ field: 'state', label: 'Status', fromRaw: 'todo', toRaw: 'done' }]
 * ```
 */
export function diffTaskFields(before: TaskRow, after: TaskRow): TaskFieldDiff[] {
  const diffs: TaskFieldDiff[] = [];
  for (const spec of TASK_AUDIT_FIELDS) {
    const fromRaw = before[spec.field];
    const toRaw = after[spec.field];
    if (!hasChanged(spec.kind, fromRaw, toRaw)) continue;
    diffs.push({ field: spec.field, label: spec.label, fromRaw, toRaw });
  }
  return diffs;
}

/** Turn a stored enum key into sentence-case display copy (`in_progress` → "In progress"). */
function humanizeEnum(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  if (words.length === 0) return value;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Shorten a free-text body to an excerpt so one edit cannot bloat the ledger row. */
function excerpt(value: string): string {
  return value.length <= DESCRIPTION_EXCERPT_LIMIT
    ? value
    : `${value.slice(0, DESCRIPTION_EXCERPT_LIMIT).trimEnd()}…`;
}

/** Collect the distinct non-null ids the diffs need looked up for one reference kind. */
function idsFor(diffs: readonly TaskFieldDiff[], kind: TaskAuditFieldKind): string[] {
  const wanted = new Set(
    TASK_AUDIT_FIELDS.filter((spec) => spec.kind === kind).map((spec) => spec.field as string),
  );
  const ids = new Set<string>();
  for (const diff of diffs) {
    if (!wanted.has(diff.field)) continue;
    for (const raw of [diff.fromRaw, diff.toRaw]) {
      if (typeof raw === 'string' && raw.length > 0) ids.add(raw);
    }
  }
  return [...ids];
}

/** Look up `id → displayName` for the ids of one reference kind, or nothing when there are none. */
async function loadNames(
  orgId: string,
  ids: readonly string[],
  kind: TaskAuditFieldKind,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const list = [...ids];

  switch (kind) {
    case 'actor': {
      const rows = await db
        .select({ id: actor.id, name: actor.displayName })
        .from(actor)
        .where(and(inArray(actor.id, list), eq(actor.organizationId, orgId)));
      for (const row of rows) names.set(row.id, row.name);
      return names;
    }
    case 'project': {
      const rows = await db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(and(inArray(project.id, list), eq(project.organizationId, orgId)));
      for (const row of rows) names.set(row.id, row.name);
      return names;
    }
    case 'program': {
      const rows = await db
        .select({ id: program.id, name: program.name })
        .from(program)
        .where(and(inArray(program.id, list), eq(program.organizationId, orgId)));
      for (const row of rows) names.set(row.id, row.name);
      return names;
    }
    case 'milestone': {
      const rows = await db
        .select({ id: milestone.id, name: milestone.name })
        .from(milestone)
        .where(and(inArray(milestone.id, list), eq(milestone.organizationId, orgId)));
      for (const row of rows) names.set(row.id, row.name);
      return names;
    }
    case 'cycle': {
      const rows = await db
        .select({
          id: cycle.id,
          name: cycle.name,
          startsAt: cycle.startsAt,
          endsAt: cycle.endsAt,
        })
        .from(cycle)
        .where(and(inArray(cycle.id, list), eq(cycle.organizationId, orgId)));
      for (const row of rows) {
        // An unnamed cycle is named by its window: the stored `number` is an epoch-anchored
        // sequence that means nothing to a reader. Shared with every other surface that renders
        // a cycle so the ledger can never disagree with the cycle page about the same cycle.
        names.set(row.id, row.name ?? defaultCycleName(row.startsAt, row.endsAt));
      }
      return names;
    }
    /* v8 ignore next -- @preserve the switch is exhaustive over the reference kinds passed here */
    default: {
      const rows = await db
        .select({ id: task.id, name: task.title })
        .from(task)
        .where(and(inArray(task.id, list), eq(task.organizationId, orgId)));
      for (const row of rows) names.set(row.id, row.name);
      return names;
    }
  }
}

/** Render one raw column value as the display string stored in the ledger. */
function displayValue(
  kind: TaskAuditFieldKind,
  raw: unknown,
  names: Map<string, string>,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (kind === 'date') return dayOf(raw);
  const text = scalarText(raw);
  if (text === null) return null;
  switch (kind) {
    case 'text':
      return text.length === 0 ? null : excerpt(text);
    case 'enum':
      return humanizeEnum(text);
    case 'number':
      return text;
    /* v8 ignore next -- @preserve every remaining kind is a reference resolved from `names` */
    default:
      return names.get(text) ?? UNRESOLVED_REFERENCE;
  }
}

/**
 * Resolve raw field diffs into display-ready {@link TaskActivityChange} entries.
 *
 * @remarks
 * Reference values are resolved in one batched query per referenced table, and only for tables a
 * changed field actually needs — a title-only edit issues no lookups at all. An id whose row can
 * no longer be read (archived, deleted, or cross-org) renders as an application-owned
 * "Unknown" rather than leaking the raw id or silently reading as "cleared".
 *
 * @param orgId - The organization the task belongs to; scopes every lookup.
 * @param diffs - The raw diffs from {@link diffTaskFields}.
 * @returns one display-ready change per diff, in the same order.
 */
export async function resolveTaskChangeLabels(
  orgId: string,
  diffs: readonly TaskFieldDiff[],
): Promise<TaskActivityChange[]> {
  if (diffs.length === 0) return [];

  const kindOf = new Map(TASK_AUDIT_FIELDS.map((spec) => [spec.field as string, spec.kind]));
  const referenceKinds: readonly TaskAuditFieldKind[] = [
    'actor',
    'project',
    'program',
    'milestone',
    'cycle',
    'task',
  ];

  // One batched lookup per referenced table, skipped entirely when no changed field needs it.
  const names = new Map<string, string>();
  for (const kind of referenceKinds) {
    const ids = idsFor(diffs, kind);
    if (ids.length === 0) continue;
    for (const [id, name] of await loadNames(orgId, ids, kind)) names.set(id, name);
  }

  return diffs.map((diff) => {
    const kind = kindOf.get(diff.field) ?? 'text';
    return {
      field: diff.field,
      label: diff.label,
      from: displayValue(kind, diff.fromRaw, names),
      to: displayValue(kind, diff.toRaw, names),
    };
  });
}

/** Input to {@link recordTaskChanges}. */
export interface RecordTaskChangesInput {
  /** The organization the task belongs to. */
  readonly organizationId: string;
  /** The task whose history is being appended to. */
  readonly taskId: string;
  /** The acting actor; null for unattributed automation. */
  readonly actorId: string | null;
  /** The display-ready changes to record, in the order they should read. */
  readonly changes: readonly TaskActivityChange[];
}

/** Input to {@link recordTaskCreated}. */
export interface RecordTaskCreatedInput {
  /** The organization the task belongs to. */
  readonly organizationId: string;
  /** The task that was just created. */
  readonly taskId: string;
  /** The actor who created it; null for unattributed automation. */
  readonly actorId: string | null;
}

/**
 * Append one ledger row per field change on a task.
 *
 * @remarks
 * All rows are written in a **single** batched insert so a multi-field edit costs one round trip.
 * That means every row of one edit shares a `createdAt` down to the microsecond, so `createdAt`
 * alone cannot order them. Ids are the tiebreak, and they are assigned deliberately: a batch of
 * ULIDs is minted, **sorted**, and handed out in change order, so reading the log back by
 * `(createdAt, id)` replays a multi-field edit in exactly the order the fields were applied. A
 * plain ULID carries a random suffix within its millisecond, so without this the entries of a
 * single edit would come back shuffled.
 *
 * Best-effort by design: a failure to write history is swallowed rather than propagated. The
 * alternative is worse — a ledger hiccup would 500 a mutation the caller has already had applied,
 * or roll back a legitimate domain write. The log may lag; the task must not break.
 *
 * @param input - The org-scoped task, the acting actor, and the resolved changes.
 */
export async function recordTaskChanges(input: RecordTaskChangesInput): Promise<void> {
  if (input.changes.length === 0) return;
  const ids = input.changes.map(() => genId()).sort();
  try {
    await db.insert(auditEvent).values(
      input.changes.map((change, index) => ({
        /* v8 ignore next -- @preserve `ids` is built from `changes`, so the index always hits */
        id: ids[index] ?? genId(),
        organizationId: input.organizationId,
        actorId: input.actorId,
        subjectType: 'task' as const,
        subjectId: input.taskId,
        type: 'updated' as const,
        metadata: { ...change },
      })),
    );
  } catch {
    // Best-effort: see the remarks above. History is never worth failing a mutation over.
  }
}

/**
 * Append the ledger row marking a task's creation — the first entry every task's log carries.
 *
 * @remarks
 * Carries an empty `metadata` because nothing changed: the entry records the task coming into
 * existence, which is why a freshly created task already has a readable history. Best-effort for
 * the same reason as {@link recordTaskChanges}.
 *
 * @param input - The org-scoped task and the creating actor.
 */
export async function recordTaskCreated(input: RecordTaskCreatedInput): Promise<void> {
  try {
    await db.insert(auditEvent).values({
      organizationId: input.organizationId,
      actorId: input.actorId,
      subjectType: 'task',
      subjectId: input.taskId,
      type: 'created',
      metadata: {},
    });
  } catch {
    // Best-effort: a missing creation entry must never fail the create itself.
  }
}
