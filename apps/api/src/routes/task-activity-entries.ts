/**
 * `@docket/api` — shaping each task Activity source into entries.
 *
 * @remarks
 * `task-activity-routes.ts` reads the sources; this module turns their rows into the one entry
 * shape the route returns. Entries backed by the audit ledger carry the origin the ledger recorded,
 * normalized through `readOrigin`, and the creation entry carries the origin of the change set that
 * created the task. Comments, timers, delegated execution updates, and subtask creation carry none.
 */
import type { auditEvent, ChangeOrigin, comment, event, sessionActivity, task } from '@docket/db';
import {
  TaskActivityChange,
  type TaskActivityCategory,
  type TaskActivityOut,
} from '@docket/connections/activity-contract';
import {
  readOrigin,
  toActivityOrigin,
  type ActivityOriginOut,
} from '@docket/work/provenance-contract';
import { taskCreationEntryId } from '@docket/work/task-model';
import type { z } from 'zod';

/** One Activity entry as the route builds it, before response validation. */
export type ActivityEntry = z.input<typeof TaskActivityOut>;

/** The fields every entry names; the rest default to null. */
type EntryCore = Pick<ActivityEntry, 'id' | 'taskId' | 'type' | 'category' | 'createdAt'>;

/** The display name joined onto a source row. */
interface ActorNamed {
  readonly actorName: string | null;
}

/** The task a related-ledger row changed. */
interface RelatedTask {
  readonly taskId: string;
  readonly taskTitle: string;
}

/** An audit-ledger row for the task itself. */
export type LedgerRow = Pick<
  typeof auditEvent.$inferSelect,
  'id' | 'actorId' | 'metadata' | 'origin' | 'createdAt'
> &
  ActorNamed;

/** An audit-ledger row for a child or blocking task. */
export type RelatedLedgerRow = LedgerRow & RelatedTask;

/** A comment on the task. */
export type CommentRow = Pick<
  typeof comment.$inferSelect,
  'id' | 'authorId' | 'body' | 'createdAt'
> &
  ActorNamed;

/** A timer transition on the task. */
export type TimerRow = Pick<typeof event.$inferSelect, 'id' | 'actor' | 'title' | 'occurredAt'>;

/** A delegated execution update on the task. */
export type SessionRow = Pick<
  typeof sessionActivity.$inferSelect,
  'id' | 'type' | 'body' | 'createdAt'
>;

/** A direct child created under the task. */
export type ChildCreationRow = Pick<
  typeof task.$inferSelect,
  'id' | 'title' | 'createdBy' | 'createdAt'
> &
  ActorNamed;

/** The task row fields the creation entry reads. */
export type CreatedTask = Pick<typeof task.$inferSelect, 'id' | 'createdBy' | 'createdAt'>;

/** Every source the route read, already visibility-filtered. */
export interface ActivitySources {
  readonly childCreations: readonly ChildCreationRow[];
  readonly directLedger: readonly LedgerRow[];
  readonly comments: readonly CommentRow[];
  readonly timerEvents: readonly TimerRow[];
  readonly taskSessions: readonly SessionRow[];
  readonly childLedger: readonly RelatedLedgerRow[];
  readonly blockerLedger: readonly RelatedLedgerRow[];
}

/** Fields from a child that alter a parent's understanding of its contained work. */
const MEANINGFUL_CHILD_FIELDS = new Set(['description', 'state', 'assigneeId', 'dueDate']);

/** Fields from a blocker that can alter whether the current task may proceed. */
const DEPENDENCY_READINESS_FIELDS = new Set(['state', 'dueDate']);

/**
 * Build one entry, defaulting every field the source does not supply to null.
 *
 * @param core - The id, task, type, category, and timestamp.
 * @param detail - Any other fields the source supplies.
 * @returns the entry.
 */
export function activityEntry(core: EntryCore, detail: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    actorId: null,
    actorName: null,
    change: null,
    body: null,
    subjectTaskId: null,
    subjectTaskTitle: null,
    origin: null,
    ...core,
    ...detail,
  };
}

/**
 * The compact origin for a stored change origin.
 *
 * @param origin - The origin as stored, if any.
 * @returns the activity origin, or null when there is none or it cannot be placed.
 */
export function activityOriginOf(
  origin: ChangeOrigin | null | undefined,
): ActivityOriginOut | null {
  const provenance = readOrigin(origin);
  return provenance ? toActivityOrigin(provenance) : null;
}

/** Read safe application text from a session activity body. */
function sessionBody(body: Record<string, unknown>, type: string): string | null {
  if (type === 'error') return 'An automated task update could not be completed.';
  const action = body['action'];
  if (action && typeof action === 'object') {
    const summary = (action as Record<string, unknown>)['summary'];
    if (typeof summary === 'string' && summary.length > 0) return summary;
  }
  const text = body['text'];
  return typeof text === 'string' && text.length > 0 ? text : null;
}

/** The Activity category a direct field change files under. */
function ledgerCategory(field: string): TaskActivityCategory {
  if (field === 'resource') return 'resource';
  if (field === 'dependency' || field === 'relatedTask') return 'relationship';
  if (field === 'subtask') return 'subtask';
  return 'task';
}

/** Whether a blocker change can alter whether the task may proceed. */
function affectsReadiness(change: TaskActivityChange): boolean {
  if (!DEPENDENCY_READINESS_FIELDS.has(change.field)) return false;
  if (change.field !== 'state') return true;
  return /done|cancel|block/i.test(`${change.from ?? ''} ${change.to ?? ''}`);
}

/**
 * The synthetic entry for the task's creation.
 *
 * @param row - The task.
 * @param creatorName - The creating actor's display name.
 * @param origin - The origin of the change set that created it, if one did.
 * @returns the creation entry.
 */
export function creationEntry(
  row: CreatedTask,
  creatorName: string | null,
  origin: ChangeOrigin | null,
): ActivityEntry {
  return activityEntry(
    {
      id: taskCreationEntryId(row.id),
      taskId: row.id,
      type: 'created',
      category: 'task',
      createdAt: row.createdAt.toISOString(),
    },
    { actorId: row.createdBy, actorName: creatorName, origin: activityOriginOf(origin) },
  );
}

/** Direct field changes, skipping ledger rows that are not field changes. */
function directLedgerEntries(taskId: string, rows: readonly LedgerRow[]): ActivityEntry[] {
  return rows.flatMap((row) => {
    const parsed = TaskActivityChange.safeParse(row.metadata);
    if (!parsed.success) return [];
    const core: EntryCore = {
      id: `audit:${row.id}`,
      taskId,
      type: 'updated',
      category: ledgerCategory(parsed.data.field),
      createdAt: row.createdAt.toISOString(),
    };
    return [
      activityEntry(core, {
        actorId: row.actorId,
        actorName: row.actorName,
        change: parsed.data,
        origin: activityOriginOf(row.origin),
      }),
    ];
  });
}

/** Field changes on a child or blocker that pass `keep`. */
function relatedLedgerEntries(
  taskId: string,
  rows: readonly RelatedLedgerRow[],
  kind: 'child' | 'dependency',
  keep: (change: TaskActivityChange) => boolean,
): ActivityEntry[] {
  const category = kind === 'child' ? 'subtask' : 'relationship';
  return rows.flatMap((row) => {
    const parsed = TaskActivityChange.safeParse(row.metadata);
    if (!parsed.success || !keep(parsed.data)) return [];
    const core: EntryCore = {
      id: `${kind}:${row.id}`,
      taskId,
      type: kind,
      category,
      createdAt: row.createdAt.toISOString(),
    };
    return [
      activityEntry(core, {
        actorId: row.actorId,
        actorName: row.actorName,
        change: parsed.data,
        subjectTaskId: row.taskId,
        subjectTaskTitle: row.taskTitle,
        origin: activityOriginOf(row.origin),
      }),
    ];
  });
}

/** Entries for the sources that carry no field change. */
function contentEntries(taskId: string, sources: ActivitySources): ActivityEntry[] {
  return [
    ...sources.childCreations.map((child) =>
      activityEntry(
        {
          id: `child-created:${child.id}`,
          taskId,
          type: 'child',
          category: 'subtask',
          createdAt: child.createdAt.toISOString(),
        },
        {
          actorId: child.createdBy,
          actorName: child.actorName,
          subjectTaskId: child.id,
          subjectTaskTitle: child.title,
        },
      ),
    ),
    ...sources.comments.map((row) =>
      activityEntry(
        {
          id: `comment:${row.id}`,
          taskId,
          type: 'comment',
          category: 'comment',
          createdAt: row.createdAt.toISOString(),
        },
        { actorId: row.authorId, actorName: row.actorName, body: row.body },
      ),
    ),
    ...sources.timerEvents.map((row) =>
      activityEntry(
        {
          id: `event:${row.id}`,
          taskId,
          type: 'timer',
          category: 'time',
          createdAt: row.occurredAt.toISOString(),
        },
        {
          actorId: row.actor?.docketActorId ?? null,
          actorName: row.actor?.displayName ?? null,
          body: row.title,
        },
      ),
    ),
    ...sources.taskSessions.map((row) =>
      activityEntry(
        {
          id: `session:${row.id}`,
          taskId,
          type: 'session',
          category: 'automation',
          createdAt: row.createdAt.toISOString(),
        },
        { body: sessionBody(row.body, row.type) },
      ),
    ),
  ];
}

/**
 * Turn every source into Activity entries, unordered.
 *
 * @param taskId - The task whose Activity this is.
 * @param sources - The visibility-filtered source rows.
 * @returns one entry per kept row.
 */
export function activityEntries(taskId: string, sources: ActivitySources): ActivityEntry[] {
  return [
    ...contentEntries(taskId, sources),
    ...directLedgerEntries(taskId, sources.directLedger),
    ...relatedLedgerEntries(taskId, sources.childLedger, 'child', (change) =>
      MEANINGFUL_CHILD_FIELDS.has(change.field),
    ),
    ...relatedLedgerEntries(taskId, sources.blockerLedger, 'dependency', affectsReadiness),
  ];
}
