import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import {
  INITIATIVE_VIEW_CONTRACT,
  InitiativeViewRow,
  PROGRAM_VIEW_CONTRACT,
  ProgramViewRow,
  PROJECT_VIEW_CONTRACT,
  ProjectViewRow,
  TASK_VIEW_CONTRACT,
  TaskViewRow,
} from '@docket/types';
import type {
  InitiativeViewRow as InitiativeViewRowOutput,
  ProgramViewRow as ProgramViewRowOutput,
  ProjectViewRow as ProjectViewRowOutput,
  TaskViewRow as TaskViewRowOutput,
} from '@docket/types';
import type {
  FilterableFieldKey,
  GroupableFieldKey,
  SortableFieldKey,
  ViewContract,
  ViewTarget,
} from '@docket/work/view-contract';

import type { FilterCompilerMap } from './filter-sql';
import type { GroupCompilerMap } from './group-sql';
import { compileProjectHasTeamSql, compileProjectTeamMembershipSql } from './project-team-sql';
import {
  tenantScalarRelationFilter,
  compileTenantRelationMembershipSql,
  tenantRelationFilter,
  WORK_VIEW_RELATIONS,
  WORK_VIEW_SCALAR_RELATIONS,
  type TenantRelationDefinition,
} from './relation-sql';
import type { SortCompilerMap } from './sort-sql';
import {
  WORK_VIEW_PROJECTIONS,
  type WorkViewSqlContext,
  type WorkViewSqlExecution,
} from './projection-sql';

const column = (name: string): SQL => sql.raw(`e.${name}`);

const statusCategoryRank = column('_status_category_rank');
const statusPositionRank = column('_status_position_rank');
const taskPriorityRank = sql`case e.priority when 'urgent' then 0 when 'high' then 1
  when 'medium' then 2 when 'low' then 3 when 'none' then 4 else 5 end`;
const initiativePriorityRank = sql`case e.priority when 'high' then 0 when 'medium' then 1
  when 'low' then 2 when 'none' then 3 else 4 end`;
const healthRank = sql`case e.health when 'off_track' then 0 when 'at_risk' then 1
  when 'on_track' then 2 else null end`;
const stringCursor = z.string().nullable();
const numberCursor = z.number().nullable();
const booleanCursor = z.boolean().nullable();
const stringSort = (value: SQL, semanticRanks?: readonly SQL[]) => ({
  value,
  cursor: stringCursor,
  ...(semanticRanks
    ? { semanticRanks, semanticCursorSchemas: semanticRanks.map(() => numberCursor) }
    : {}),
});
const numberSort = (value: SQL, semanticRanks?: readonly SQL[]) => ({
  value,
  cursor: numberCursor,
  ...(semanticRanks
    ? { semanticRanks, semanticCursorSchemas: semanticRanks.map(() => numberCursor) }
    : {}),
});
const booleanSort = (value: SQL) => ({ value, cursor: booleanCursor });

const taskFilter = {
  status: { kind: 'enum', value: column('state') },
  priority: { kind: 'enum', value: column('priority') },
  assignee: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('assignee_id')),
  delegate: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('delegate_id')),
  team: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.team, column('team_id')),
  project: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.project, column('project_id')),
  program: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.program, column('program_id')),
  cycle: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.cycle, column('cycle_id')),
  milestone: tenantScalarRelationFilter(
    WORK_VIEW_SCALAR_RELATIONS.milestone,
    column('milestone_id'),
  ),
  parent: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.task, column('parent_task_id')),
  labels: tenantRelationFilter(WORK_VIEW_RELATIONS.taskLabels),
  title: { kind: 'text', value: column('title') },
  creator: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('created_by')),
  startDate: { kind: 'date', value: column('start_date') },
  dueDate: { kind: 'date', value: column('due_date') },
  createdAt: { kind: 'datetime', value: column('created_at') },
  updatedAt: { kind: 'datetime', value: column('updated_at') },
  estimate: { kind: 'number', value: column('estimate') },
  estimateMinutes: { kind: 'number', value: column('estimate_minutes') },
  blocked: {
    kind: 'boolean',
    value: column('_blocked'),
  },
  blocking: {
    kind: 'boolean',
    value: column('_blocking'),
  },
  unfiled: { kind: 'boolean', value: column('_unfiled') },
  archived: { kind: 'boolean', value: column('_archived') },
} satisfies FilterCompilerMap<FilterableFieldKey<typeof TASK_VIEW_CONTRACT>>;

const taskSort = {
  status: stringSort(column('state'), [statusCategoryRank, statusPositionRank]),
  priority: stringSort(column('priority'), [taskPriorityRank]),
  title: stringSort(column('title')),
  startDate: stringSort(column('start_date')),
  dueDate: stringSort(column('due_date')),
  createdAt: stringSort(column('created_at')),
  updatedAt: stringSort(column('updated_at')),
  estimate: numberSort(column('estimate')),
  estimateMinutes: numberSort(column('estimate_minutes')),
  blocked: booleanSort(taskFilter.blocked.value),
  blocking: booleanSort(taskFilter.blocking.value),
  archived: booleanSort(taskFilter.archived.value),
} satisfies SortCompilerMap<SortableFieldKey<typeof TASK_VIEW_CONTRACT>>;

const relationGroup = (definition: TenantRelationDefinition) => ({
  kind: 'fanout' as const,
  memberships: (entityId: SQL) => sql`select membership.value_id as key,
      membership.value_label as label
    from (${compileTenantRelationMembershipSql(
      definition,
      entityId,
      sql`e.organization_id`,
    )}) membership`,
});
const scalar = (name: string, label: SQL = column(name)) => ({
  kind: 'scalar' as const,
  key: column(name),
  label,
});
const actorGroup = (name: string) => ({
  kind: 'scalar' as const,
  key: sql`(select a.id from actor a where a.id=e.${sql.raw(name)}
    and a.organization_id=e.organization_id)`,
  label: sql`(select a.display_name from actor a where a.id=e.${sql.raw(name)}
    and a.organization_id=e.organization_id)`,
});
const namedGroup = (name: string, table: string) => ({
  kind: 'scalar' as const,
  key: sql`(select named.id from ${sql.raw(table)} named where named.id=e.${sql.raw(name)}
    and named.organization_id=e.organization_id)`,
  label: sql`(select named.name from ${sql.raw(table)} named where named.id=e.${sql.raw(name)}
    and named.organization_id=e.organization_id)`,
});
const statusGroup = (name: string) =>
  scalar(
    name,
    sql`(select ws.name from work_status ws where ws.id=e.status_id
      and ws.organization_id=e.organization_id)`,
  );

const taskGroup = {
  status: statusGroup('state'),
  priority: scalar('priority'),
  assignee: actorGroup('assignee_id'),
  delegate: actorGroup('delegate_id'),
  team: namedGroup('team_id', 'team'),
  project: namedGroup('project_id', 'project'),
  program: namedGroup('program_id', 'program'),
  cycle: {
    kind: 'scalar',
    key: sql`(select c.id from cycle c where c.id=e.cycle_id
      and c.organization_id=e.organization_id)`,
    label: sql`(select coalesce(c.name, 'Cycle ' || c.number::text) from cycle c
      where c.id=e.cycle_id and c.organization_id=e.organization_id)`,
  },
  milestone: namedGroup('milestone_id', 'milestone'),
  labels: relationGroup(WORK_VIEW_RELATIONS.taskLabels),
  creator: actorGroup('created_by'),
  dueDate: scalar('due_date'),
  estimate: scalar('estimate'),
} satisfies GroupCompilerMap<GroupableFieldKey<typeof TASK_VIEW_CONTRACT>>;

const projectFilter = {
  status: { kind: 'enum', value: column('status') },
  priority: { kind: 'enum', value: column('priority') },
  health: { kind: 'enum', value: column('health') },
  lead: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('lead_id')),
  members: tenantRelationFilter(WORK_VIEW_RELATIONS.projectMembers),
  teams: {
    kind: 'relation-many',
    exists: (operand) =>
      compileProjectHasTeamSql(sql`e.id`, sql`e.organization_id`, sql`e.team_id`, operand),
    isEmpty: sql`not exists (
      select 1 from (${compileProjectTeamMembershipSql(
        sql`e.id`,
        sql`e.organization_id`,
        sql`e.team_id`,
      )}) project_teams
    )`,
  },
  program: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.program, column('program_id')),
  initiatives: tenantRelationFilter(WORK_VIEW_RELATIONS.projectInitiatives),
  labels: tenantRelationFilter(WORK_VIEW_RELATIONS.projectLabels),
  startDate: { kind: 'date', value: column('start_date') },
  targetDate: { kind: 'date', value: column('target_date') },
  creator: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('created_by')),
  createdAt: { kind: 'datetime', value: column('created_at') },
  updatedAt: { kind: 'datetime', value: column('updated_at') },
  progress: {
    kind: 'number',
    value: column('_progress'),
  },
  taskCount: { kind: 'number', value: column('_task_count') },
  dependencyCount: {
    kind: 'number',
    value: column('_dependency_count'),
  },
  name: { kind: 'text', value: column('name') },
} satisfies FilterCompilerMap<FilterableFieldKey<typeof PROJECT_VIEW_CONTRACT>>;

const projectSort = {
  status: stringSort(column('status'), [statusCategoryRank, statusPositionRank]),
  priority: stringSort(column('priority'), [taskPriorityRank]),
  health: stringSort(column('health'), [healthRank]),
  startDate: stringSort(column('start_date')),
  targetDate: stringSort(column('target_date')),
  createdAt: stringSort(column('created_at')),
  updatedAt: stringSort(column('updated_at')),
  progress: numberSort(projectFilter.progress.value),
  taskCount: numberSort(projectFilter.taskCount.value),
  dependencyCount: numberSort(projectFilter.dependencyCount.value),
  name: stringSort(column('name')),
} satisfies SortCompilerMap<SortableFieldKey<typeof PROJECT_VIEW_CONTRACT>>;

const projectGroup = {
  status: statusGroup('status'),
  priority: scalar('priority'),
  health: scalar('health'),
  lead: actorGroup('lead_id'),
  members: relationGroup(WORK_VIEW_RELATIONS.projectMembers),
  teams: {
    kind: 'fanout',
    memberships: (id: SQL) =>
      sql`select t.id::text key, t.name::text label
        from (${compileProjectTeamMembershipSql(id, sql`e.organization_id`, sql`e.team_id`)}) project_teams
        join team t on t.id=project_teams.team_id and t.organization_id=e.organization_id`,
  },
  program: namedGroup('program_id', 'program'),
  initiatives: relationGroup(WORK_VIEW_RELATIONS.projectInitiatives),
  labels: relationGroup(WORK_VIEW_RELATIONS.projectLabels),
  creator: actorGroup('created_by'),
} satisfies GroupCompilerMap<GroupableFieldKey<typeof PROJECT_VIEW_CONTRACT>>;

const programFilter = {
  status: { kind: 'enum', value: column('status') },
  health: { kind: 'enum', value: column('health') },
  owner: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('owner_id')),
  initiatives: tenantRelationFilter(WORK_VIEW_RELATIONS.programInitiatives),
  labels: tenantRelationFilter(WORK_VIEW_RELATIONS.programLabels),
  visibility: { kind: 'enum', value: column('visibility') },
  creator: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('created_by')),
  updatedAt: { kind: 'datetime', value: column('updated_at') },
  projectCount: {
    kind: 'number',
    value: column('_project_count'),
  },
  taskCount: {
    kind: 'number',
    value: column('_task_count'),
  },
  name: { kind: 'text', value: column('name') },
} satisfies FilterCompilerMap<FilterableFieldKey<typeof PROGRAM_VIEW_CONTRACT>>;

const programSort = {
  status: stringSort(column('status'), [statusCategoryRank, statusPositionRank]),
  health: stringSort(column('health'), [healthRank]),
  visibility: stringSort(column('visibility')),
  updatedAt: stringSort(column('updated_at')),
  projectCount: numberSort(programFilter.projectCount.value),
  taskCount: numberSort(programFilter.taskCount.value),
  name: stringSort(column('name')),
} satisfies SortCompilerMap<SortableFieldKey<typeof PROGRAM_VIEW_CONTRACT>>;

const programGroup = {
  status: statusGroup('status'),
  health: scalar('health'),
  owner: actorGroup('owner_id'),
  initiatives: relationGroup(WORK_VIEW_RELATIONS.programInitiatives),
  labels: relationGroup(WORK_VIEW_RELATIONS.programLabels),
  visibility: scalar('visibility'),
  creator: actorGroup('created_by'),
} satisfies GroupCompilerMap<GroupableFieldKey<typeof PROGRAM_VIEW_CONTRACT>>;

const initiativeFilter = {
  status: { kind: 'enum', value: column('status') },
  priority: { kind: 'enum', value: column('priority') },
  health: { kind: 'enum', value: column('health') },
  owner: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.actor, column('owner_id')),
  leadTeam: tenantScalarRelationFilter(WORK_VIEW_SCALAR_RELATIONS.team, column('lead_team_id')),
  labels: tenantRelationFilter(WORK_VIEW_RELATIONS.initiativeLabels),
  targetDate: { kind: 'date', value: column('target_date') },
  updateCadence: { kind: 'enum', value: column('update_cadence') },
  latestUpdate: {
    kind: 'datetime',
    value: column('_latest_update'),
  },
  parent: {
    kind: 'relation-one',
    value: sql`(select h.parent_initiative_id from initiative_hierarchy_link h
      join authorized parent on parent.id=h.parent_initiative_id
      where h.child_initiative_id=e.id
        and h.context_organization_id=e._context_organization_id limit 1)`,
  },
  organization: { kind: 'relation-one', value: column('organization_id') },
  name: { kind: 'text', value: column('name') },
} satisfies FilterCompilerMap<FilterableFieldKey<typeof INITIATIVE_VIEW_CONTRACT>>;

const initiativeSort = {
  status: stringSort(column('status'), [statusCategoryRank, statusPositionRank]),
  priority: stringSort(column('priority'), [initiativePriorityRank]),
  health: stringSort(column('health'), [healthRank]),
  targetDate: stringSort(column('target_date')),
  updateCadence: stringSort(column('update_cadence')),
  latestUpdate: stringSort(initiativeFilter.latestUpdate.value),
  name: stringSort(column('name')),
} satisfies SortCompilerMap<SortableFieldKey<typeof INITIATIVE_VIEW_CONTRACT>>;

const initiativeGroup = {
  status: statusGroup('status'),
  priority: scalar('priority'),
  health: scalar('health'),
  owner: actorGroup('owner_id'),
  leadTeam: namedGroup('lead_team_id', 'team'),
  labels: relationGroup(WORK_VIEW_RELATIONS.initiativeLabels),
  updateCadence: scalar('update_cadence'),
  organization: scalar(
    'organization_id',
    sql`(select organization.name from organization where organization.id=e.organization_id)`,
  ),
} satisfies GroupCompilerMap<GroupableFieldKey<typeof INITIATIVE_VIEW_CONTRACT>>;

/** Runtime work-view row output keyed by its target discriminator. */
export interface WorkViewRowByTarget {
  readonly task: TaskViewRowOutput;
  readonly project: ProjectViewRowOutput;
  readonly program: ProgramViewRowOutput;
  readonly initiative: InitiativeViewRowOutput;
}

const workViewRowSchemas = {
  task: TaskViewRow,
  project: ProjectViewRow,
  program: ProgramViewRow,
  initiative: InitiativeViewRow,
} satisfies { readonly [TTarget in ViewTarget]: z.ZodType<WorkViewRowByTarget[TTarget]> };

/** Exhaustive SQL registries for one target contract. */
export interface WorkViewSqlContract<TContract extends ViewContract> {
  /** Shared target contract. */
  readonly contract: TContract;
  /** SQL table name used as alias `e`. */
  readonly table: string;
  /** Every filterable target field. */
  readonly filters: FilterCompilerMap<FilterableFieldKey<TContract>>;
  /** Every sortable target field. */
  readonly sorts: SortCompilerMap<SortableFieldKey<TContract>>;
  /** Every groupable target field. */
  readonly groups: GroupCompilerMap<GroupableFieldKey<TContract>>;
  /** Target-specific SQL projection tied to the row schema. */
  readonly projection: (context: WorkViewSqlContext, execution: WorkViewSqlExecution) => SQL;
  /** Runtime parser for one projected transport row. */
  readonly rowSchema: z.ZodType<WorkViewRowByTarget[TContract['target']]>;
}

/** Target-indexed registry that preserves each contract's exact derived keys. */
export interface WorkViewSqlContractRegistry {
  readonly task: WorkViewSqlContract<typeof TASK_VIEW_CONTRACT>;
  readonly project: WorkViewSqlContract<typeof PROJECT_VIEW_CONTRACT>;
  readonly program: WorkViewSqlContract<typeof PROGRAM_VIEW_CONTRACT>;
  readonly initiative: WorkViewSqlContract<typeof INITIATIVE_VIEW_CONTRACT>;
}

/** Target-indexed exhaustive server compiler contracts. */
export const WORK_VIEW_SQL_CONTRACTS = {
  task: {
    contract: TASK_VIEW_CONTRACT,
    table: 'task',
    filters: taskFilter,
    sorts: taskSort,
    groups: taskGroup,
    projection: WORK_VIEW_PROJECTIONS.task,
    rowSchema: workViewRowSchemas.task,
  },
  project: {
    contract: PROJECT_VIEW_CONTRACT,
    table: 'project',
    filters: projectFilter,
    sorts: projectSort,
    groups: projectGroup,
    projection: WORK_VIEW_PROJECTIONS.project,
    rowSchema: workViewRowSchemas.project,
  },
  program: {
    contract: PROGRAM_VIEW_CONTRACT,
    table: 'program',
    filters: programFilter,
    sorts: programSort,
    groups: programGroup,
    projection: WORK_VIEW_PROJECTIONS.program,
    rowSchema: workViewRowSchemas.program,
  },
  initiative: {
    contract: INITIATIVE_VIEW_CONTRACT,
    table: 'initiative',
    filters: initiativeFilter,
    sorts: initiativeSort,
    groups: initiativeGroup,
    projection: WORK_VIEW_PROJECTIONS.initiative,
    rowSchema: workViewRowSchemas.initiative,
  },
} satisfies WorkViewSqlContractRegistry;
