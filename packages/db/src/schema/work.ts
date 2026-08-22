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
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { FractionalRank } from '@docket/types';
import type { ViewTarget } from '@docket/work/view-contract';

import {
  cycleStatus,
  health,
  initiativePriority,
  initiativeUpdateCadence,
  planningDateResolution,
  provenanceSource,
  sourceSystem,
  syncMode,
  taskPriority,
  visibility,
} from '../enums';
import { notBlank } from './constraints';
import { actor, auditColumns, organization, team } from './identity';
import { integration } from './crosscutting';
import { workStatus } from './work-status';

/**
 * How every table on this island points at its status.
 *
 * @remarks
 * A row that carries a status stores two things: `status_id`, which is the authority, and the
 * `status`/`state` key string that every reader, connector, saved view, and API response has
 * always used. Each table declares a composite foreign key over
 * `(status_id, <key column>, organization_id)` referencing
 * `work_status (id, key, organization_id)`.
 *
 * Referencing the triple rather than `id` alone is what makes the pair provably consistent: the
 * key column cannot drift from the status it names, because a row where they disagree does not
 * store. Including the organization makes a cross-tenant status unrepresentable for the same
 * reason.
 *
 * `ON UPDATE CASCADE` turns a key rewrite into one statement instead of a cross-table backfill.
 * `ON DELETE RESTRICT` is what requires a status deletion to remap its work first.
 */

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

/** Require precise dates to have no fiscal metadata and broad dates to have a complete pair. */
function planningTimeframePair(
  name: string,
  date: SQLWrapper,
  resolution: SQLWrapper,
  fiscalYearStartMonth: SQLWrapper,
) {
  return check(
    name,
    sql`(
      (${resolution} is null and ${fiscalYearStartMonth} is null)
      or
      (${date} is not null and ${resolution} is not null and ${fiscalYearStartMonth} is not null and ${fiscalYearStartMonth} between 0 and 11)
    )`,
  );
}

/** Require a broad date anchor to sit on the first or final day of its saved fiscal period. */
function planningTimeframeBoundary(
  name: string,
  date: SQLWrapper,
  resolution: SQLWrapper,
  fiscalYearStartMonth: SQLWrapper,
  edge: 'start' | 'target',
) {
  const shifted = sql`(${date} - make_interval(months => ${fiscalYearStartMonth}))`;
  const monthStart = sql`date_trunc('month', ${date})`;
  const quarterStart = sql`date_trunc('quarter', ${shifted}) + make_interval(months => ${fiscalYearStartMonth})`;
  const halfYearStart = sql`date_trunc('year', ${shifted}) + make_interval(months => ((extract(month from ${shifted})::int - 1) / 6) * 6 + ${fiscalYearStartMonth})`;
  const yearStart = sql`date_trunc('year', ${shifted}) + make_interval(months => ${fiscalYearStartMonth})`;
  const boundary = (start: SQLWrapper, months: number) =>
    edge === 'start'
      ? sql`(${start})`
      : sql`(${start} + make_interval(months => ${sql.raw(String(months))}) - interval '1 day')`;
  return check(
    name,
    sql`(
      ${resolution} is null
      or (${resolution} = 'month' and ${date}::date = (${boundary(monthStart, 1)})::date)
      or (${resolution} = 'quarter' and ${date}::date = (${boundary(quarterStart, 3)})::date)
      or (${resolution} = 'halfYear' and ${date}::date = (${boundary(halfYearStart, 6)})::date)
      or (${resolution} = 'year' and ${date}::date = (${boundary(yearStart, 12)})::date)
    )`,
  );
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
    leadTeamId: text('lead_team_id').references(() => team.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('active'),
    statusId: text('status_id').notNull(),
    priority: initiativePriority('priority').notNull().default('none'),
    updateCadence: initiativeUpdateCadence('update_cadence').notNull().default('monthly'),
    targetDate: timestamp('target_date'),
    targetDateResolution: planningDateResolution('target_date_resolution'),
    targetDateFiscalYearStartMonth: integer('target_date_fiscal_year_start_month'),
    health: health('health'),
  },
  (t) => [
    index('initiative_org_idx').on(t.organizationId),
    index('initiative_status_idx').on(t.statusId),
    foreignKey({
      name: 'initiative_status_fk',
      columns: [t.statusId, t.status, t.organizationId],
      foreignColumns: [workStatus.id, workStatus.key, workStatus.organizationId],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    notBlank('initiative_name_not_blank', t.name),
    notBlank('initiative_status_not_blank', t.status),
    dateInRange('initiative_target_date_range', t.targetDate),
    planningTimeframePair(
      'initiative_target_timeframe_pair_check',
      t.targetDate,
      t.targetDateResolution,
      t.targetDateFiscalYearStartMonth,
    ),
    planningTimeframeBoundary(
      'initiative_target_timeframe_boundary_check',
      t.targetDate,
      t.targetDateResolution,
      t.targetDateFiscalYearStartMonth,
      'target',
    ),
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
    status: text('status').notNull().default('active'),
    statusId: text('status_id').notNull(),
    health: health('health'),
    visibility: visibility('visibility').notNull().default('public'),
    ancestorPath: text('ancestor_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    index('program_org_idx').on(t.organizationId),
    index('program_status_idx').on(t.statusId),
    index('program_ancestor_path_gin').using('gin', t.ancestorPath),
    foreignKey({
      name: 'program_status_fk',
      columns: [t.statusId, t.status, t.organizationId],
      foreignColumns: [workStatus.id, workStatus.key, workStatus.organizationId],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    notBlank('program_name_not_blank', t.name),
    notBlank('program_status_not_blank', t.status),
  ],
);

/** A planning item's shared fractional rank inside one workspace-owned context. */
export const workItemOrder = pgTable(
  'work_item_order',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    contextType: text('context_type')
      .$type<'organization' | 'team' | 'project' | 'program' | 'initiative'>()
      .notNull(),
    contextId: text('context_id').notNull(),
    target: text('target').$type<ViewTarget>().notNull(),
    itemId: text('item_id').notNull(),
    rank: text('rank').$type<FractionalRank>().notNull(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.contextType, t.contextId, t.target, t.itemId],
    }),
    index('work_item_order_context_rank_idx').on(
      t.organizationId,
      t.contextType,
      t.contextId,
      t.target,
      t.rank,
    ),
    check(
      'work_item_order_context_type_check',
      sql`${t.contextType} in ('organization', 'team', 'project', 'program', 'initiative')`,
    ),
    check(
      'work_item_order_target_check',
      sql`${t.target} in ('task', 'project', 'program', 'initiative')`,
    ),
    notBlank('work_item_order_context_id_not_blank', t.contextId),
    notBlank('work_item_order_item_id_not_blank', t.itemId),
    notBlank('work_item_order_rank_not_blank', t.rank),
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
    status: text('status').notNull().default('planned'),
    statusId: text('status_id').notNull(),
    priority: taskPriority('priority').notNull().default('none'),
    health: health('health'),
    startDate: timestamp('start_date'),
    startDateResolution: planningDateResolution('start_date_resolution'),
    startDateFiscalYearStartMonth: integer('start_date_fiscal_year_start_month'),
    targetDate: timestamp('target_date'),
    targetDateResolution: planningDateResolution('target_date_resolution'),
    targetDateFiscalYearStartMonth: integer('target_date_fiscal_year_start_month'),
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
    index('project_status_idx').on(t.statusId),
    index('project_program_idx').on(t.programId),
    index('project_ancestor_path_gin').using('gin', t.ancestorPath),
    uniqueIndex('project_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.source} = 'linked'`),
    foreignKey({
      name: 'project_status_fk',
      columns: [t.statusId, t.status, t.organizationId],
      foreignColumns: [workStatus.id, workStatus.key, workStatus.organizationId],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    notBlank('project_name_not_blank', t.name),
    notBlank('project_status_not_blank', t.status),
    dateInRange('project_start_date_range', t.startDate),
    dateInRange('project_target_date_range', t.targetDate),
    planningTimeframePair(
      'project_start_timeframe_pair_check',
      t.startDate,
      t.startDateResolution,
      t.startDateFiscalYearStartMonth,
    ),
    planningTimeframeBoundary(
      'project_start_timeframe_boundary_check',
      t.startDate,
      t.startDateResolution,
      t.startDateFiscalYearStartMonth,
      'start',
    ),
    planningTimeframePair(
      'project_target_timeframe_pair_check',
      t.targetDate,
      t.targetDateResolution,
      t.targetDateFiscalYearStartMonth,
    ),
    planningTimeframeBoundary(
      'project_target_timeframe_boundary_check',
      t.targetDate,
      t.targetDateResolution,
      t.targetDateFiscalYearStartMonth,
      'target',
    ),
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
    description: text('description'),
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
    statusId: text('status_id').notNull(),
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
    index('task_status_idx').on(t.statusId),
    index('task_project_idx').on(t.projectId),
    index('task_program_idx').on(t.programId),
    index('task_ancestor_path_gin').using('gin', t.ancestorPath),
    uniqueIndex('task_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.source} = 'linked'`),
    foreignKey({
      name: 'task_status_fk',
      columns: [t.statusId, t.state, t.organizationId],
      foreignColumns: [workStatus.id, workStatus.key, workStatus.organizationId],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    notBlank('task_title_not_blank', t.title),
    // `state` is the key of the status in `status_id`, held to it by `task_status_fk`. The two
    // cannot disagree, so a reader that has only ever known `state` keeps working while
    // `status_id` carries the authority. The blank check predates that FK and stays as the floor.
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

/**
 * The link between one inbound item and the task an automation rule routed it to.
 *
 * @remarks
 * The ledger that makes stream-monitoring-to-task-creation usable rather than a duplicate
 * factory. Every `task.route` action writes one row keyed by
 * `(organization_id, source_system, source_key)`, where `source_key` is the inbound item's
 * *stable* external identity — an email's RFC 5322 Message-ID, a GitHub pull request's node
 * id — and NOT the identity of the delivery that carried it. Two consequences follow, and
 * both are the point:
 *
 * - **Idempotence.** The same email re-listed by a later mailbox sweep, or the same webhook
 *   redelivered, resolves to the row that already exists and updates that task. One inbound
 *   item is one task, however many times it is seen.
 * - **Linkage.** A pull request that is opened and later closed is one `source_key` across
 *   two deliveries, so the close updates the task the open created instead of filing a second
 *   one next to it.
 *
 * `organization_id` is the workspace the task LANDED in, which is the routing target and may
 * differ from {@link inboundTaskRoute.originOrganizationId} — the workspace whose integration
 * received the item. A personal mailbox feeding work into a client's workspace is the case
 * that separation exists for, and the unique key uses the target so the same item may legitimately
 * route into two workspaces without either one duplicating it.
 */
export const inboundTaskRoute = pgTable(
  'inbound_task_route',
  {
    ...auditColumns(),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    /** Which tool the item arrived from (`gmail` | `github` | `linear` | …). */
    sourceSystem: sourceSystem('source_system').notNull(),
    /** The item's stable external identity — the dedupe and linkage key (see the remarks). */
    sourceKey: text('source_key').notNull(),
    /** Canonical open-in-source URL captured at routing time (the provenance a person clicks). */
    sourceUrl: text('source_url'),
    /** The integration the item arrived through, when it arrived through one. */
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    /** The workspace the item arrived in, when it differs from the workspace routed to. */
    originOrganizationId: text('origin_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('inbound_task_route_source_uq').on(t.organizationId, t.sourceSystem, t.sourceKey),
    index('inbound_task_route_task_idx').on(t.taskId),
    // A key that is present but empty would collapse every keyless item in a workspace onto one
    // task — the exact failure the unique index above exists to prevent, arriving through the
    // back door. Routing declines to act without a real key; this is the floor under that.
    notBlank('inbound_task_route_source_key_not_blank', t.sourceKey),
  ],
);
