/**
 * `@docket/db` — work-hierarchy schema island (data-model §4).
 *
 * @remarks
 * Initiative (theme) → Program (ongoing ops, no `completed`) → Project (bounded) →
 * Task, plus team-scoped Cycle and project-scoped Milestone. Containment nodes
 * (program/project/task) carry `visibility` + `ancestor_path` (GIN-indexed) for the
 * permission cascade. Task dependencies are cross-project and live in `./joins`.
 *
 * **Constraints are the floor, not the ceiling.** Every DTO in `@docket/types` validates a write
 * before it reaches here, but a DTO only protects the writers that go through it. This island is
 * also written by connector reconcile, MCP tools, the email-to-task path, seed data and future
 * migrations, so the invariants a reader depends on — a date that names a possible day, a duration
 * that is not negative, a name that is not whitespace — are declared as CHECK constraints too. See
 * {@link TASK_DATE_FLOOR}.
 */
import { sql, type SQLWrapper } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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

/**
 * The earliest instant any planning date on this island may name.
 *
 * @remarks
 * `timestamp` guarantees a date is a real point in time; it does not guarantee the point is one
 * anyone meant. A `0226-05-01` mistyped for `2026-05-01` is a perfectly valid timestamp and a
 * perfectly broken due date — it sorts to the top of every list forever and no UI ever shows it
 * back. Bounding the range is what turns "parses" into "possible", which is what the product means
 * by a date being valid. Mirrored by `TASK_DATE_MIN`/`TASK_DATE_MAX` in `@docket/types` so the API
 * boundary rejects the same values with a 422 instead of a constraint violation.
 */
const TASK_DATE_FLOOR = '1970-01-01';

/** The exclusive upper bound for any planning date on this island. See {@link TASK_DATE_FLOOR}. */
const TASK_DATE_CEILING = '2201-01-01';

/**
 * A CHECK asserting a nullable planning date falls inside the plausible range.
 *
 * @param name - The constraint name, `<table>_<column>_range` by convention.
 * @param column - The nullable timestamp column to bound.
 * @returns the drizzle CHECK constraint to spread into a table's extras list.
 */
function dateInRange(name: string, column: SQLWrapper) {
  // The bounds are `sql.raw` because a CHECK expression is DDL, not a query: a bound parameter
  // would be emitted as `$1` into the migration and never resolve.
  const floor = sql.raw(`'${TASK_DATE_FLOOR}'`);
  const ceiling = sql.raw(`'${TASK_DATE_CEILING}'`);
  return check(name, sql`${column} is null or (${column} >= ${floor} and ${column} < ${ceiling})`);
}

/**
 * A CHECK asserting a required name column holds at least one non-whitespace character.
 *
 * @remarks
 * `NOT NULL` permits `''` and `'   '`, which render as a blank row a reader cannot click,
 * search or tell apart from its neighbours — an unusable record that no surface can repair
 * because it looks like nothing is there.
 *
 * The test is `~ '[^[:space:]]'` rather than `length(btrim(x)) > 0` because Postgres' one-argument
 * `btrim` strips spaces and nothing else: a title of a single tab survives that check and is just
 * as blank on screen. The POSIX class covers tabs, newlines and the rest.
 *
 * @param name - The constraint name, `<table>_<column>_not_blank` by convention.
 * @param column - The text column to require content in.
 * @returns the drizzle CHECK constraint to spread into a table's extras list.
 */
function notBlank(name: string, column: SQLWrapper) {
  return check(name, sql`${column} ~ ${sql.raw("'[^[:space:]]'")}`);
}

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
  (t) => [
    index('initiative_org_idx').on(t.organizationId),
    notBlank('initiative_name_not_blank', t.name),
    dateInRange('initiative_target_date_range', t.targetDate),
  ],
);

/** An ongoing area of operations; contains Projects + recurring Tasks. No end state. */
export const program = pgTable(
  'program',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    description: text('description'),
    summary: text('summary'),
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
    notBlank('program_name_not_blank', t.name),
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
    notBlank('project_name_not_blank', t.name),
    dateInRange('project_start_date_range', t.startDate),
    dateInRange('project_target_date_range', t.targetDate),
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
  (t) => [
    index('milestone_project_idx').on(t.projectId),
    notBlank('milestone_name_not_blank', t.name),
    dateInRange('milestone_target_date_range', t.targetDate),
    check('milestone_sort_nonneg', sql`${t.sort} >= 0`),
  ],
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
    // A cycle IS its window: "current" is decided by comparing now against it, and every cycle
    // surface renders `startsAt – endsAt`. A window that ends before it starts is a cycle that is
    // never current and reads as nonsense, so it is not storable.
    check('cycle_window_ordered', sql`${t.endsAt} > ${t.startsAt}`),
    check('cycle_number_nonneg', sql`${t.number} >= 0`),
    dateInRange('cycle_starts_at_range', t.startsAt),
    dateInRange('cycle_ends_at_range', t.endsAt),
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
    notBlank('task_title_not_blank', t.title),
    // `state` is a per-team workflow key, so its domain is data (`team.workflow_states`), not a
    // fixed enum — a pg enum here would be wrong, and the FK that would be right does not exist
    // because workflow states are stored as jsonb on the team. What is checkable without that
    // refactor is that the key is a key: an empty state silently drops a task out of every board
    // column, which is worse than an unknown one.
    notBlank('task_state_not_blank', t.state),
    // A task is not its own subtask. The deeper acyclicity invariant is enforced in the write
    // transaction (`wouldCreateSubtaskCycle`); this is the one case a constraint can see.
    check('task_not_own_parent', sql`${t.parentTaskId} is null or ${t.parentTaskId} <> ${t.id}`),
    // Negative effort is not a smaller estimate, it is a corrupt one — it subtracts from every
    // rollup it lands in. Zero is legitimate ("no work left").
    check('task_estimate_nonneg', sql`${t.estimate} is null or ${t.estimate} >= 0`),
    check(
      'task_estimate_minutes_nonneg',
      sql`${t.estimateMinutes} is null or ${t.estimateMinutes} >= 0`,
    ),
    dateInRange('task_start_date_range', t.startDate),
    dateInRange('task_due_date_range', t.dueDate),
  ],
);
