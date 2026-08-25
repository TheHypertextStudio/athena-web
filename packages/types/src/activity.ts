/**
 * `@docket/types` — Activity (audit-feed) slice DTOs.
 *
 * @remarks
 * An audit event is one entry in an organization's universal activity feed. Agent
 * actions carry both an `actorId` (the agent's Actor) and an `initiatorId` (the human
 * who triggered it). The feed is org-scoped and read-only over the API surface; events
 * are written by the entity routers (optionally via the shared `writeAudit` helper).
 */
import { z } from 'zod';

import { ActorId, AuditEventId, OrganizationId, TaskId } from './primitives';

/** Audit-feed subject kinds; `agent` is a first-class subject. */
export const AuditSubjectType = z
  .enum([
    'organization',
    'team',
    'initiative',
    'program',
    'project',
    'cycle',
    'task',
    'actor',
    'agent',
    'agent_session',
    'comment',
    'update',
    'integration',
    'role',
    'grant',
    'membership',
  ])
  .describe(
    'The kind of Docket entity an audit event is about — what `subjectId` points to. Spans the work hierarchy (`organization`/`team`/`initiative`/`program`/`project`/`cycle`/`task`), identity/access (`actor`/`role`/`grant`/`membership`), collaboration (`comment`/`update`), integrations (`integration`), and the agent layer (`agent`, `agent_session` — the latter carries approve/reject gate decisions).',
  );
/** Audit-subject-type value. */
export type AuditSubjectType = z.infer<typeof AuditSubjectType>;

/** Audit-feed event kinds. */
export const AuditEventType = z
  .enum([
    'created',
    'updated',
    'state_changed',
    'assigned',
    'commented',
    'archived',
    'deleted',
    'moved',
    'linked',
    'member_added',
    'member_removed',
    'role_changed',
    'grant_changed',
    'approved',
    'rejected',
  ])
  .describe(
    'The action recorded: lifecycle (`created`/`updated`/`archived`/`deleted`), workflow (`state_changed`/`assigned`/`moved`/`linked`), collaboration (`commented`), access (`member_added`/`member_removed`/`role_changed`/`grant_changed`), and agent approval-gate decisions (`approved`/`rejected`, written on an `agent_session` subject when a human clears or vetoes a proposed agent action).',
  );
/** Audit-event-type value. */
export type AuditEventType = z.infer<typeof AuditEventType>;

/** Full audit-event representation returned by the org activity feed. */
export const AuditEventOut = z
  .object({
    id: AuditEventId.describe('The audit-event id.'),
    organizationId: OrganizationId.describe('The organization whose feed this event belongs to.'),
    actorId: ActorId.nullable()
      .optional()
      .describe(
        "WHO performed the action — for an agent action this is the agent's Actor, for a human action the human's Actor; null when system-generated.",
      ),
    initiatorId: ActorId.nullable()
      .optional()
      .describe(
        'WHO is accountable for triggering it — present (the human) on agent actions so the feed shows both the acting agent and the authorizing human; null/omitted for direct human actions.',
      ),
    subjectType: AuditSubjectType.describe(
      'The kind of entity acted upon — what `subjectId` references.',
    ),
    subjectId: z.string().describe('The id of the subject entity the event is about.'),
    type: AuditEventType.describe('What action was recorded.'),
    metadata: z
      .record(z.string(), z.unknown())
      .describe(
        'Event-specific detail — e.g. for `approved`/`rejected` the decided `activityId` and the `approverActorId`; for `state_changed` the before/after states.',
      ),
    createdAt: z
      .string()
      .describe('ISO-8601 timestamp the event was recorded — the feed sort key (descending).'),
  })
  .meta({ id: 'AuditEventOut', description: 'An entry in an organization activity feed.' });
/** Audit-event representation value. */
export type AuditEventOut = z.infer<typeof AuditEventOut>;

/** One field-level metadata change recorded on a task's activity log. */
export const TaskActivityChange = z
  .object({
    field: z
      .string()
      .describe(
        'Stable machine key for the changed field (e.g. `state`, `assigneeId`, `startDate`) — safe to branch on; never rendered.',
      ),
    label: z
      .string()
      .describe(
        'Application-owned display label for the field (e.g. "Status", "Assignee", "Anticipated start"). Never a column name and never provider prose.',
      ),
    from: z
      .string()
      .nullable()
      .describe('Display-ready previous value, resolved at write time; null when it was unset.'),
    to: z
      .string()
      .nullable()
      .describe(
        'Display-ready new value, resolved at write time; null when the field was cleared.',
      ),
  })
  .meta({
    id: 'TaskActivityChange',
    description: 'A single before/after field change on a task.',
  });
/** Task-activity change value. */
export type TaskActivityChange = z.infer<typeof TaskActivityChange>;

/** The user-facing category that narrows one task Activity history. */
export const TaskActivityCategory = z
  .enum(['task', 'comment', 'time', 'resource', 'relationship', 'subtask', 'automation'])
  .meta({
    id: 'TaskActivityCategory',
    description:
      'A filter category within one task Activity history. Categories narrow one chronological list and never select a separate feed.',
  });
/** Task Activity category value. */
export type TaskActivityCategory = z.infer<typeof TaskActivityCategory>;

/** Kinds of entries projected into a task's one Activity history. */
export const TaskActivityType = z
  .enum(['created', 'updated', 'comment', 'timer', 'session', 'child', 'dependency'])
  .meta({
    id: 'TaskActivityType',
    description:
      'The durable source shape for a task Activity entry. It lets a client render content without splitting the record into comment, history, timer, or session surfaces.',
  });
/** Task Activity entry type. */
export type TaskActivityType = z.infer<typeof TaskActivityType>;

/** Query parameters for one cursor-paginated task Activity history. */
export const TaskActivityQuery = z
  .object({
    cursor: z
      .string()
      .optional()
      .describe('Opaque position from `nextCursor`; omit it for the first Activity page.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum number of Activity entries to return, from 1 through 100.'),
    category: TaskActivityCategory.optional().describe(
      'Optional filter for one category inside the same chronological Activity history.',
    ),
  })
  .meta({ id: 'TaskActivityQuery', description: 'Read one filtered page of task Activity.' });
/** Task Activity query value. */
export type TaskActivityQuery = z.infer<typeof TaskActivityQuery>;

/**
 * One entry in a task's activity log — its creation, or one metadata field changing.
 *
 * @remarks
 * `change.from`/`change.to` are **display strings resolved when the entry was written**, not raw
 * ids. That is deliberate on two counts. History must be immutable: renaming a project later must
 * not retroactively rewrite what the log says happened last month. And the reader must never have
 * to resolve an id it may no longer be able to see (a since-archived project, a departed member) —
 * the entry is self-contained.
 *
 * Ordering is ascending by `(createdAt, id)` — oldest first, the way a GitHub issue log reads —
 * and ids are ULIDs, so entries written inside the same millisecond still order deterministically.
 */
export const TaskActivityOut = z
  .object({
    id: z
      .string()
      .describe(
        'Stable entry id: a ULID for a recorded change (also the tiebreak for ordering within a millisecond), or the synthetic `created:<taskId>` for the creation entry, which is projected from the task row rather than stored.',
      ),
    taskId: TaskId.describe('The task this entry belongs to.'),
    actorId: ActorId.nullable().describe(
      'WHO made the change; null when the change was system- or automation-generated with no attributable actor.',
    ),
    actorName: z
      .string()
      .nullable()
      .describe(
        "The acting actor's display name, resolved server-side so the client never resolves an id; null for system/automation entries.",
      ),
    type: TaskActivityType.describe(
      'Whether this entry is task creation, a task field change, a comment, timer transition, session update, meaningful child change, or dependency readiness change.',
    ),
    category: TaskActivityCategory.describe(
      'The filter category that this entry belongs to inside the single Activity history.',
    ),
    change: TaskActivityChange.nullable().describe(
      'The field that changed; null when the entry is a comment, timer, session update, or creation.',
    ),
    body: z
      .string()
      .nullable()
      .describe(
        'Display-safe comment text or application-owned event text; null for field changes.',
      ),
    subjectTaskId: TaskId.nullable().describe(
      'The child or dependency task responsible for a propagated entry; null for a direct task entry.',
    ),
    subjectTaskTitle: z
      .string()
      .nullable()
      .describe('The title of `subjectTaskId` at read time; null for direct task entries.'),
    createdAt: z
      .string()
      .describe('Exact ISO-8601 timestamp the change was recorded — the ascending sort key.'),
  })
  .meta({
    id: 'TaskActivityOut',
    description: "An entry in a task's metadata activity log.",
  });
/** Task-activity entry value. */
export type TaskActivityOut = z.infer<typeof TaskActivityOut>;
