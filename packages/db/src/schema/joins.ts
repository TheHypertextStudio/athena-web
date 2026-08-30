/**
 * `@docket/db` — join-table schema island (data-model §4/§5).
 *
 * @remarks
 * Initiative↔Project and Initiative↔Program many-to-many links, the five entity↔Label
 * joins, and the cross-project directed `blocks` dependency graph. Every join retains
 * `organization_id` (frozen) so tenant-scoped queries never cross a join boundary.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { actor, organization, team } from './identity';
import { initiative, program, project, task } from './work';
import { label } from './crosscutting';
import { externalResource } from './resources';

/** Many-to-many: a Project can belong to several Teams, with at most one primary Team. */
export const projectTeam = pgTable(
  'project_team',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.teamId] }),
    uniqueIndex('project_team_one_primary_uq')
      .on(t.projectId)
      .where(sql`${t.isPrimary} = true`),
    index('project_team_team_idx').on(t.teamId),
  ],
);

/** Many-to-many: participating Project members, separate from the accountable lead. */
export const projectMember = pgTable(
  'project_member',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.actorId] }),
    index('project_member_actor_idx').on(t.actorId),
  ],
);

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
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.projectId] }),
    index('initiative_project_project_idx').on(t.organizationId, t.projectId, t.initiativeId),
  ],
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

/** A context-owned parent/child edge between independently owned Initiatives. */
export const initiativeHierarchyLink = pgTable(
  'initiative_hierarchy_link',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    contextOrganizationId: text('context_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    parentInitiativeId: text('parent_initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    childInitiativeId: text('child_initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => actor.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('initiative_hierarchy_context_child_uq').on(
      t.contextOrganizationId,
      t.childInitiativeId,
    ),
    index('initiative_hierarchy_context_parent_idx').on(
      t.contextOrganizationId,
      t.parentInitiativeId,
    ),
    check('initiative_hierarchy_no_self', sql`${t.parentInitiativeId} <> ${t.childInitiativeId}`),
  ],
);

/** Many-to-many: Initiatives ↔ organization-global Labels. */
export const initiativeLabel = pgTable(
  'initiative_label',
  {
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.labelId] })],
);

/** Many-to-many: Projects ↔ organization-global Labels. */
export const projectLabel = pgTable(
  'project_label',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.labelId] })],
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

/** Many-to-many: Programs ↔ Labels. */
export const programLabel = pgTable(
  'program_label',
  {
    programId: text('program_id')
      .notNull()
      .references(() => program.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.programId, t.labelId] })],
);

/**
 * Many-to-many: Library resources ↔ Labels.
 *
 * @remarks
 * The Library is the one non-work surface that earns labels: a resource is filed once and
 * retrieved by topic later, which is exactly what a label is for. Cycles and milestones are
 * deliberately absent — a cycle is a date range, and a milestone is read through its project.
 */
export const resourceLabel = pgTable(
  'resource_label',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => externalResource.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.labelId] })],
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

/** An undirected task relationship stored once in lexicographic endpoint order. */
export const taskRelatedTask = pgTable(
  'task_related_task',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    relatedTaskId: text('related_task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.relatedTaskId] }),
    index('task_related_task_related_idx').on(t.relatedTaskId),
    check('task_related_task_no_self', sql`${t.taskId} <> ${t.relatedTaskId}`),
    check('task_related_task_canonical_order', sql`${t.taskId} < ${t.relatedTaskId}`),
  ],
);

/** A directed Project `blocks` edge (blocking → blocked), scoped to one organization. */
export const projectDependency = pgTable(
  'project_dependency',
  {
    blockingProjectId: text('blocking_project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    blockedProjectId: text('blocked_project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.blockingProjectId, t.blockedProjectId] }),
    index('project_dependency_blocked_idx').on(t.blockedProjectId),
    check('project_dependency_no_self', sql`${t.blockingProjectId} <> ${t.blockedProjectId}`),
  ],
);
