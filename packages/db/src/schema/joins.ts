/**
 * `@docket/db` — join-table schema island (data-model §4/§5).
 *
 * @remarks
 * Initiative↔Project and Initiative↔Program many-to-many links, Task↔Label, and the
 * cross-project directed `blocks` dependency graph. Every join retains
 * `organization_id` (frozen) so tenant-scoped queries never cross a join boundary.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { organization } from './identity';
import { initiative, program, project, task } from './work';
import { label } from './crosscutting';

/** Many-to-many: an Initiative groups bounded Projects. */
export const initiativeProject = pgTable(
  'initiative_project',
  {
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.projectId] })],
);

/** Many-to-many: an Initiative spans ongoing Programs. */
export const initiativeProgram = pgTable(
  'initiative_program',
  {
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => program.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.programId] })],
);

/** Many-to-many: Tasks ↔ Labels. */
export const taskLabel = pgTable(
  'task_label',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);

/** A directed `blocks` edge (blocking → blocked); cross-project, acyclic, no self-loops. */
export const taskDependency = pgTable(
  'task_dependency',
  {
    blockingTaskId: text('blocking_task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    blockedTaskId: text('blocked_task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.blockingTaskId, t.blockedTaskId] }),
    index('task_dependency_blocked_idx').on(t.blockedTaskId),
    check('task_dependency_no_self', sql`${t.blockingTaskId} <> ${t.blockedTaskId}`),
  ],
);
