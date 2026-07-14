/**
 * `@docket/db` — work-hierarchy schema island (data-model §4).
 *
 * @remarks
 * Initiative (theme) → Program (ongoing ops, no `completed`) → Project (bounded) →
 * Task, plus team-scoped Cycle and project-scoped Milestone. Containment nodes
 * (program/project/task) carry `visibility` + `ancestor_path` (GIN-indexed) for the
 * permission cascade. Task dependencies are cross-project and live in `./joins`.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import {
  cycleStatus,
  health,
  initiativePriority,
  initiativeStatus,
  initiativeUpdateCadence,
  programStatus,
  projectStatus,
  provenanceSource,
  syncMode,
  taskPriority,
  visibility,
} from '../enums';
import { actor, auditColumns, team } from './identity';
import { integration } from './crosscutting';

/** A cross-cutting theme over Projects/Programs (m2m); contains no work itself. */
export const initiative = pgTable(
  'initiative',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    summary: text('summary'),
    description: text('description'),
    ownerId: text('owner_id').references(() => actor.id, { onDelete: 'set null' }),
    status: initiativeStatus('status').notNull().default('active'),
    priority: initiativePriority('priority').notNull().default('none'),
    updateCadence: initiativeUpdateCadence('update_cadence').notNull().default('monthly'),
    targetDate: timestamp('target_date'),
    health: health('health'),
  },
  (t) => [index('initiative_org_idx').on(t.organizationId)],
);

/** An ongoing area of operations; contains Projects + recurring Tasks. No end state. */
export const program = pgTable(
  'program',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: text('owner_id').references(() => actor.id, { onDelete: 'set null' }),
    status: programStatus('status').notNull().default('active'),
    health: health('health'),
    visibility: visibility('visibility').notNull().default('public'),
    ancestorPath: text('ancestor_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    index('program_org_idx').on(t.organizationId),
    index('program_ancestor_path_gin').using('gin', t.ancestorPath),
  ],
);

/** A bounded effort with an outcome and optional deadline; sits under a Program or Org. */
export const project = pgTable(
  'project',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    summary: text('summary'),
    description: text('description'),
    leadId: text('lead_id').references(() => actor.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => program.id, { onDelete: 'set null' }),
    teamId: text('team_id').references(() => team.id, { onDelete: 'set null' }),
    status: projectStatus('status').notNull().default('planned'),
    health: health('health'),
    startDate: timestamp('start_date'),
    targetDate: timestamp('target_date'),
    visibility: visibility('visibility').notNull().default('public'),
    ancestorPath: text('ancestor_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Provenance (single inline triple): native vs mirrored-from-an-integration. Pull-only
    // mirror (no `externalEtag`/`externalListId`/`lastPushedAt` — see task's two-way variant).
    source: provenanceSource('source').notNull().default('native'),
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    externalUpdatedAt: timestamp('external_updated_at'),
  },
  (t) => [
    index('project_org_idx').on(t.organizationId),
    index('project_ancestor_path_gin').using('gin', t.ancestorPath),
    uniqueIndex('project_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.source} = 'linked'`),
  ],
);

/** A dated checkpoint grouping some of a Project's Tasks (a Project attribute). */
export const milestone = pgTable(
  'milestone',
  {
    ...auditColumns(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetDate: timestamp('target_date'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('milestone_project_idx').on(t.projectId)],
);

/** A team-scoped cadence (sprint/cycle) tasks can be assigned to. */
export const cycle = pgTable(
  'cycle',
  {
    ...auditColumns(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name'),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    status: cycleStatus('status').notNull().default('upcoming'),
    // Provenance (single inline triple): native vs mirrored-from-an-integration. Pull-only
    // mirror (no `externalEtag`/`externalListId`/`lastPushedAt` — see task's two-way variant).
    source: provenanceSource('source').notNull().default('native'),
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    externalUpdatedAt: timestamp('external_updated_at'),
  },
  (t) => [
    index('cycle_team_idx').on(t.teamId),
    uniqueIndex('cycle_team_number_uq').on(t.teamId, t.number),
    uniqueIndex('cycle_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.source} = 'linked'`),
  ],
);

/** The unit of work; cross-project dependencies live in `./joins`. */
export const task = pgTable(
  'task',
  {
    ...auditColumns(),
    title: text('title').notNull(),
    description: text('description'),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    priority: taskPriority('priority').notNull().default('none'),
    assigneeId: text('assignee_id').references(() => actor.id, { onDelete: 'set null' }),
    delegateId: text('delegate_id').references(() => actor.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => program.id, { onDelete: 'set null' }),
    milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
    cycleId: text('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id'),
    estimate: integer('estimate'),
    estimateMinutes: integer('estimate_minutes'),
    startDate: timestamp('start_date'),
    dueDate: timestamp('due_date'),
    // Provenance (single inline triple): native vs linked-from-an-integration.
    source: provenanceSource('source').notNull().default('native'),
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    sourceSyncMode: syncMode('source_sync_mode'),
    // Two-way sync bookkeeping (gtasks bidirectional). `externalUpdatedAt` is both the
    // last-write-wins anchor AND the echo guard: a linked task is dirty (needs push) iff
    // `externalUpdatedAt IS NOT NULL AND updatedAt > externalUpdatedAt`. Every sync write
    // sets `externalUpdatedAt = updatedAt = <remote updated>` so the next pull is a no-op.
    externalUpdatedAt: timestamp('external_updated_at'),
    externalEtag: text('external_etag'),
    externalListId: text('external_list_id'),
    lastPushedAt: timestamp('last_pushed_at'),
    completedAt: timestamp('completed_at'),
    canceledAt: timestamp('canceled_at'),
    visibility: visibility('visibility').notNull().default('public'),
    ancestorPath: text('ancestor_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    index('task_org_idx').on(t.organizationId),
    index('task_team_state_idx').on(t.teamId, t.state),
    index('task_project_idx').on(t.projectId),
    index('task_ancestor_path_gin').using('gin', t.ancestorPath),
    uniqueIndex('task_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.source} = 'linked'`),
  ],
);
