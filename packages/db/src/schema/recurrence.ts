/**
 * `@docket/db` — normalized repeating-work and process-execution schema island.
 *
 * @remarks
 * Behavior is represented by discriminants plus typed relational columns, never by executable or
 * opaque JSON. Definitions are versioned independently from schedules; occurrences and concrete
 * instance mappings preserve history while future revisions change what Docket creates next.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  health,
  missedOccurrencePolicy,
  processCreationMode,
  processDefinitionStatus,
  processInstanceStatus,
  processOccurrenceStatus,
  processStepKind,
  processStepTimingKind,
  processTriggerKind,
  recurrenceCalendarOverflow,
  recurrenceEndKind,
  recurrenceExceptionKind,
  recurrenceIntervalUnit,
  recurrenceMonthlyPatternKind,
  recurrenceScheduleKind,
  recurrenceSeriesStatus,
  taskPriority,
} from '../enums';
import { calendarLayer } from './calendar';
import { label } from './crosscutting';
import { actor, auditColumns, organization, team } from './identity';
import { cycle, milestone, program, project, task } from './work';

/** A named reusable process whose immutable revisions describe generated work. */
export const processDefinition = pgTable(
  'process_definition',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    description: text('description'),
    status: processDefinitionStatus('status').notNull().default('draft'),
  },
  (t) => [
    index('process_definition_org_status_idx').on(t.organizationId, t.status),
    check('process_definition_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

/** One immutable authored version of a process graph. */
export const processRevision = pgTable(
  'process_revision',
  {
    ...auditColumns(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => processDefinition.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    creationMode: processCreationMode('creation_mode').notNull().default('all_at_once'),
    publishedAt: timestamp('published_at'),
  },
  (t) => [
    uniqueIndex('process_revision_definition_number_uq').on(t.definitionId, t.number),
    index('process_revision_org_definition_idx').on(t.organizationId, t.definitionId),
    check('process_revision_number_positive', sql`${t.number} > 0`),
  ],
);

/** Shared identity, ordering, kind, and timing for any project/milestone/task process step. */
export const processStep = pgTable(
  'process_step',
  {
    ...auditColumns(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => processRevision.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    kind: processStepKind('kind').notNull(),
    sort: integer('sort').notNull().default(0),
    timingKind: processStepTimingKind('timing_kind').notNull().default('on_trigger'),
    offsetDays: integer('offset_days'),
    afterStepId: text('after_step_id'),
  },
  (t) => [
    uniqueIndex('process_step_revision_key_uq').on(t.revisionId, t.key),
    index('process_step_org_revision_idx').on(t.organizationId, t.revisionId),
    foreignKey({
      columns: [t.afterStepId],
      foreignColumns: [t.id],
      name: 'process_step_after_step_fk',
    }).onDelete('restrict'),
    check('process_step_sort_nonneg', sql`${t.sort} >= 0`),
    check(
      'process_step_timing_shape_check',
      sql`(
        (${t.timingKind} = 'on_trigger' and ${t.offsetDays} is null and ${t.afterStepId} is null)
        or (${t.timingKind} = 'relative_to_trigger' and ${t.offsetDays} is not null and ${t.afterStepId} is null)
        or (${t.timingKind} = 'after_step_completion' and ${t.offsetDays} is not null and ${t.offsetDays} >= 0 and ${t.afterStepId} is not null)
      )`,
    ),
    check(
      'process_step_not_own_predecessor',
      sql`${t.afterStepId} is null or ${t.afterStepId} <> ${t.id}`,
    ),
  ],
);

/** Project-specific fields for a `project` process step. */
export const processProjectSpec = pgTable(
  'process_project_spec',
  {
    stepId: text('step_id')
      .primaryKey()
      .references(() => processStep.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    summary: text('summary'),
    description: text('description'),
    leadId: text('lead_id').references(() => actor.id, { onDelete: 'set null' }),
    teamId: text('team_id').references(() => team.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => program.id, { onDelete: 'set null' }),
    // A Project status key, mirroring `project.status`. No composite FK: a template is
    // org-wide and may be applied long after a workspace reshaped its statuses, so the
    // key is resolved when the Project is created rather than held to a status now.
    status: text('status').notNull().default('planned'),
    health: health('health'),
    startOffsetDays: integer('start_offset_days'),
    targetOffsetDays: integer('target_offset_days'),
  },
  (t) => [
    index('process_project_spec_org_idx').on(t.organizationId),
    check('process_project_spec_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check(
      'process_project_spec_date_offsets_ordered',
      sql`${t.startOffsetDays} is null or ${t.targetOffsetDays} is null or ${t.targetOffsetDays} >= ${t.startOffsetDays}`,
    ),
  ],
);

/** Milestone-specific fields for a `milestone` process step. */
export const processMilestoneSpec = pgTable(
  'process_milestone_spec',
  {
    stepId: text('step_id')
      .primaryKey()
      .references(() => processStep.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectStepId: text('project_step_id')
      .notNull()
      .references(() => processProjectSpec.stepId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    targetOffsetDays: integer('target_offset_days'),
  },
  (t) => [
    index('process_milestone_spec_org_project_idx').on(t.organizationId, t.projectStepId),
    check('process_milestone_spec_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

/** Task-specific fields for a `task` process step. */
export const processTaskSpec = pgTable(
  'process_task_spec',
  {
    stepId: text('step_id')
      .primaryKey()
      .references(() => processStep.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'restrict' }),
    state: text('state'),
    priority: taskPriority('priority').notNull().default('none'),
    assigneeId: text('assignee_id').references(() => actor.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    projectStepId: text('project_step_id').references(() => processProjectSpec.stepId, {
      onDelete: 'cascade',
    }),
    milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
    milestoneStepId: text('milestone_step_id').references(() => processMilestoneSpec.stepId, {
      onDelete: 'cascade',
    }),
    cycleId: text('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id').references(() => task.id, { onDelete: 'set null' }),
    parentTaskStepId: text('parent_task_step_id'),
    estimate: integer('estimate'),
    estimateMinutes: integer('estimate_minutes'),
    startOffsetDays: integer('start_offset_days'),
    dueOffsetDays: integer('due_offset_days'),
  },
  (t) => [
    index('process_task_spec_org_team_idx').on(t.organizationId, t.teamId),
    foreignKey({
      columns: [t.parentTaskStepId],
      foreignColumns: [t.stepId],
      name: 'process_task_spec_parent_fk',
    }).onDelete('set null'),
    check('process_task_spec_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    check(
      'process_task_spec_state_not_blank',
      sql`${t.state} is null or length(btrim(${t.state})) > 0`,
    ),
    check('process_task_spec_estimate_nonneg', sql`${t.estimate} is null or ${t.estimate} >= 0`),
    check(
      'process_task_spec_estimate_minutes_nonneg',
      sql`${t.estimateMinutes} is null or ${t.estimateMinutes} >= 0`,
    ),
    check(
      'process_task_spec_not_own_parent',
      sql`${t.parentTaskStepId} is null or ${t.parentTaskStepId} <> ${t.stepId}`,
    ),
    check(
      'process_task_spec_reference_shape_check',
      sql`${t.projectId} is null or ${t.projectStepId} is null`,
    ),
    check(
      'process_task_spec_milestone_reference_shape_check',
      sql`${t.milestoneId} is null or ${t.milestoneStepId} is null`,
    ),
    check(
      'process_task_spec_parent_reference_shape_check',
      sql`${t.parentTaskId} is null or ${t.parentTaskStepId} is null`,
    ),
    check(
      'process_task_spec_date_offsets_ordered',
      sql`${t.startOffsetDays} is null or ${t.dueOffsetDays} is null or ${t.dueOffsetDays} >= ${t.startOffsetDays}`,
    ),
  ],
);

/** Labels copied onto a generated task from its task specification. */
export const processTaskLabelSpec = pgTable(
  'process_task_label_spec',
  {
    taskStepId: text('task_step_id')
      .notNull()
      .references(() => processTaskSpec.stepId, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskStepId, t.labelId] }),
    index('process_task_label_spec_org_idx').on(t.organizationId),
  ],
);

/** Labels copied onto a generated project from its project specification. */
export const processProjectLabelSpec = pgTable(
  'process_project_label_spec',
  {
    projectStepId: text('project_step_id')
      .notNull()
      .references(() => processProjectSpec.stepId, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.projectStepId, t.labelId] }),
    index('process_project_label_spec_org_idx').on(t.organizationId),
  ],
);

/** A blocking edge between two task steps in one process revision. */
export const processDependency = pgTable(
  'process_dependency',
  {
    revisionId: text('revision_id')
      .notNull()
      .references(() => processRevision.id, { onDelete: 'cascade' }),
    blockingStepId: text('blocking_step_id')
      .notNull()
      .references(() => processTaskSpec.stepId, { onDelete: 'cascade' }),
    blockedStepId: text('blocked_step_id')
      .notNull()
      .references(() => processTaskSpec.stepId, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.blockingStepId, t.blockedStepId] }),
    index('process_dependency_org_revision_idx').on(t.organizationId, t.revisionId),
    check('process_dependency_not_self', sql`${t.blockingStepId} <> ${t.blockedStepId}`),
  ],
);

/** A named lifecycle container whose revisions decide when a process runs. */
export const recurrenceSeries = pgTable(
  'recurrence_series',
  {
    ...auditColumns(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => processDefinition.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: recurrenceSeriesStatus('status').notNull().default('active'),
    pausedAt: timestamp('paused_at'),
    endedAt: timestamp('ended_at'),
  },
  (t) => [
    index('recurrence_series_org_status_idx').on(t.organizationId, t.status),
    check('recurrence_series_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check(
      'recurrence_series_lifecycle_shape_check',
      sql`(
        (${t.status} = 'active' and ${t.endedAt} is null)
        or (${t.status} = 'paused' and ${t.pausedAt} is not null and ${t.endedAt} is null)
        or (${t.status} = 'ended' and ${t.endedAt} is not null)
      )`,
    ),
  ],
);

/** One immutable trigger/schedule version for a recurrence series. */
export const recurrenceSeriesRevision = pgTable(
  'recurrence_series_revision',
  {
    ...auditColumns(),
    seriesId: text('series_id')
      .notNull()
      .references(() => recurrenceSeries.id, { onDelete: 'cascade' }),
    processRevisionId: text('process_revision_id')
      .notNull()
      .references(() => processRevision.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    triggerKind: processTriggerKind('trigger_kind').notNull(),
    scheduleKind: recurrenceScheduleKind('schedule_kind'),
    interval: integer('interval'),
    startDate: date('start_date'),
    timezone: text('timezone'),
    endKind: recurrenceEndKind('end_kind'),
    endDate: date('end_date'),
    endCount: integer('end_count'),
    monthlyPatternKind: recurrenceMonthlyPatternKind('monthly_pattern_kind'),
    monthDay: integer('month_day'),
    nthWeekdayOrdinal: integer('nth_weekday_ordinal'),
    nthWeekday: integer('nth_weekday'),
    yearMonth: integer('year_month'),
    yearDay: integer('year_day'),
    overflow: recurrenceCalendarOverflow('overflow'),
    intervalUnit: recurrenceIntervalUnit('interval_unit'),
    missedPolicy: missedOccurrencePolicy('missed_policy'),
    horizonDays: integer('horizon_days'),
    minimumOccurrences: integer('minimum_occurrences'),
    eventKind: text('event_kind'),
    eventSubjectType: text('event_subject_type'),
    eventSource: text('event_source'),
    eventEntityKind: text('event_entity_kind'),
  },
  (t) => [
    uniqueIndex('recurrence_series_revision_series_number_uq').on(t.seriesId, t.number),
    uniqueIndex('recurrence_series_revision_series_effective_uq').on(t.seriesId, t.effectiveFrom),
    index('recurrence_series_revision_org_series_idx').on(t.organizationId, t.seriesId),
    check('recurrence_series_revision_number_positive', sql`${t.number} > 0`),
    check(
      'recurrence_series_revision_trigger_shape_check',
      sql`(
        (${t.triggerKind} = 'manual' and ${t.scheduleKind} is null and ${t.interval} is null and ${t.startDate} is null and ${t.timezone} is null and ${t.endKind} is null and ${t.missedPolicy} is null and ${t.horizonDays} is null and ${t.minimumOccurrences} is null and ${t.intervalUnit} is null and ${t.eventKind} is null and ${t.eventSubjectType} is null and ${t.eventSource} is null and ${t.eventEntityKind} is null)
        or (${t.triggerKind} = 'calendar' and ${t.scheduleKind} is not null and ${t.interval} > 0 and ${t.startDate} is not null and length(btrim(${t.timezone})) > 0 and ${t.endKind} is not null and ${t.missedPolicy} is not null and ${t.horizonDays} > 0 and ${t.minimumOccurrences} > 0 and ${t.intervalUnit} is null)
        or (${t.triggerKind} = 'after_completion' and ${t.scheduleKind} is null and ${t.interval} > 0 and ${t.intervalUnit} is not null and ${t.startDate} is null and ${t.timezone} is null and ${t.endKind} is null and ${t.missedPolicy} is null and ${t.horizonDays} is null and ${t.minimumOccurrences} is null)
        or (${t.triggerKind} = 'event' and ${t.scheduleKind} is null and ${t.interval} is null and ${t.intervalUnit} is null and (${t.eventKind} is not null or ${t.eventSubjectType} is not null or ${t.eventSource} is not null or ${t.eventEntityKind} is not null))
      )`,
    ),
    check(
      'recurrence_series_revision_end_shape_check',
      sql`(
        (${t.triggerKind} <> 'calendar' and ${t.endKind} is null and ${t.endDate} is null and ${t.endCount} is null)
        or (${t.triggerKind} = 'calendar' and ${t.endKind} = 'never' and ${t.endDate} is null and ${t.endCount} is null)
        or (${t.triggerKind} = 'calendar' and ${t.endKind} = 'on_date' and ${t.endDate} is not null and ${t.endCount} is null and ${t.endDate} >= ${t.startDate})
        or (${t.triggerKind} = 'calendar' and ${t.endKind} = 'after_count' and ${t.endDate} is null and ${t.endCount} > 0)
      )`,
    ),
    check(
      'recurrence_series_revision_schedule_shape_check',
      sql`(
        (${t.scheduleKind} is null and ${t.monthlyPatternKind} is null and ${t.monthDay} is null and ${t.nthWeekdayOrdinal} is null and ${t.nthWeekday} is null and ${t.yearMonth} is null and ${t.yearDay} is null and ${t.overflow} is null)
        or (${t.scheduleKind} in ('daily', 'weekly') and ${t.monthlyPatternKind} is null and ${t.monthDay} is null and ${t.nthWeekdayOrdinal} is null and ${t.nthWeekday} is null and ${t.yearMonth} is null and ${t.yearDay} is null and ${t.overflow} is null)
        or (${t.scheduleKind} = 'monthly' and ${t.monthlyPatternKind} = 'day_of_month' and ${t.monthDay} between 1 and 31 and ${t.nthWeekdayOrdinal} is null and ${t.nthWeekday} is null and ${t.yearMonth} is null and ${t.yearDay} is null and ${t.overflow} is not null)
        or (${t.scheduleKind} = 'monthly' and ${t.monthlyPatternKind} = 'nth_weekday' and ${t.monthDay} is null and ${t.nthWeekdayOrdinal} in (-1, 1, 2, 3, 4, 5) and ${t.nthWeekday} between 1 and 7 and ${t.yearMonth} is null and ${t.yearDay} is null and ${t.overflow} is null)
        or (${t.scheduleKind} = 'yearly' and ${t.monthlyPatternKind} is null and ${t.monthDay} is null and ${t.nthWeekdayOrdinal} is null and ${t.nthWeekday} is null and ${t.yearMonth} between 1 and 12 and ${t.yearDay} between 1 and 31 and ${t.overflow} is not null)
      )`,
    ),
  ],
);

/** A selected weekday for one weekly series revision (`1` Monday through `7` Sunday). */
export const recurrenceSeriesWeekday = pgTable(
  'recurrence_series_weekday',
  {
    seriesRevisionId: text('series_revision_id')
      .notNull()
      .references(() => recurrenceSeriesRevision.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesRevisionId, t.weekday] }),
    check('recurrence_series_weekday_range', sql`${t.weekday} between 1 and 7`),
  ],
);

/** A date inclusion, exclusion, or reschedule layered onto a series revision. */
export const recurrenceException = pgTable(
  'recurrence_exception',
  {
    ...auditColumns(),
    seriesRevisionId: text('series_revision_id')
      .notNull()
      .references(() => recurrenceSeriesRevision.id, { onDelete: 'cascade' }),
    kind: recurrenceExceptionKind('kind').notNull(),
    scheduledFor: date('scheduled_for').notNull(),
    replacementDate: date('replacement_date'),
  },
  (t) => [
    uniqueIndex('recurrence_exception_revision_date_uq').on(t.seriesRevisionId, t.scheduledFor),
    index('recurrence_exception_org_revision_idx').on(t.organizationId, t.seriesRevisionId),
    check(
      'recurrence_exception_shape_check',
      sql`(
        (${t.kind} in ('exclude', 'include') and ${t.replacementDate} is null)
        or (${t.kind} = 'reschedule' and ${t.replacementDate} is not null and ${t.replacementDate} <> ${t.scheduledFor})
      )`,
    ),
  ],
);

/** One durable expected run of a recurrence series. */
export const processOccurrence = pgTable(
  'process_occurrence',
  {
    ...auditColumns(),
    seriesId: text('series_id')
      .notNull()
      .references(() => recurrenceSeries.id, { onDelete: 'cascade' }),
    seriesRevisionId: text('series_revision_id')
      .notNull()
      .references(() => recurrenceSeriesRevision.id, { onDelete: 'restrict' }),
    scheduledFor: date('scheduled_for').notNull(),
    originalScheduledFor: date('original_scheduled_for'),
    status: processOccurrenceStatus('status').notNull().default('expected'),
    externalOccurrenceKey: text('external_occurrence_key'),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => [
    uniqueIndex('process_occurrence_revision_date_uq')
      .on(t.seriesId, t.seriesRevisionId, t.scheduledFor)
      .where(sql`${t.externalOccurrenceKey} is null`),
    uniqueIndex('process_occurrence_series_external_uq')
      .on(t.seriesId, t.externalOccurrenceKey)
      .where(sql`${t.externalOccurrenceKey} is not null`),
    index('process_occurrence_org_status_date_idx').on(t.organizationId, t.status, t.scheduledFor),
  ],
);

/** One concrete execution of a process revision. */
export const processInstance = pgTable(
  'process_instance',
  {
    ...auditColumns(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => processDefinition.id, { onDelete: 'restrict' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => processRevision.id, { onDelete: 'restrict' }),
    occurrenceId: text('occurrence_id').references(() => processOccurrence.id, {
      onDelete: 'restrict',
    }),
    status: processInstanceStatus('status').notNull().default('active'),
    triggeredAt: timestamp('triggered_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    failedAt: timestamp('failed_at'),
    failureCode: text('failure_code'),
  },
  (t) => [
    uniqueIndex('process_instance_occurrence_uq')
      .on(t.occurrenceId)
      .where(sql`${t.occurrenceId} is not null`),
    index('process_instance_org_status_idx').on(t.organizationId, t.status),
  ],
);

/** Mapping from one project process step to the concrete generated Project. */
export const processInstanceProject = pgTable(
  'process_instance_project',
  {
    ...auditColumns(),
    instanceId: text('instance_id')
      .notNull()
      .references(() => processInstance.id, { onDelete: 'cascade' }),
    stepId: text('step_id')
      .notNull()
      .references(() => processProjectSpec.stepId, { onDelete: 'restrict' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('process_instance_project_instance_step_uq').on(t.instanceId, t.stepId),
    uniqueIndex('process_instance_project_project_uq').on(t.projectId),
    index('process_instance_project_org_idx').on(t.organizationId),
  ],
);

/** Mapping from one milestone process step to the concrete generated Milestone. */
export const processInstanceMilestone = pgTable(
  'process_instance_milestone',
  {
    ...auditColumns(),
    instanceId: text('instance_id')
      .notNull()
      .references(() => processInstance.id, { onDelete: 'cascade' }),
    stepId: text('step_id')
      .notNull()
      .references(() => processMilestoneSpec.stepId, { onDelete: 'restrict' }),
    milestoneId: text('milestone_id')
      .notNull()
      .references(() => milestone.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('process_instance_milestone_instance_step_uq').on(t.instanceId, t.stepId),
    uniqueIndex('process_instance_milestone_milestone_uq').on(t.milestoneId),
    index('process_instance_milestone_org_idx').on(t.organizationId),
  ],
);

/** Mapping from one task process step to the concrete generated Task. */
export const processInstanceTask = pgTable(
  'process_instance_task',
  {
    ...auditColumns(),
    instanceId: text('instance_id')
      .notNull()
      .references(() => processInstance.id, { onDelete: 'cascade' }),
    stepId: text('step_id')
      .notNull()
      .references(() => processTaskSpec.stepId, { onDelete: 'restrict' }),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('process_instance_task_instance_step_uq').on(t.instanceId, t.stepId),
    uniqueIndex('process_instance_task_task_uq').on(t.taskId),
    index('process_instance_task_org_idx').on(t.organizationId),
  ],
);

/** Stable binding from one external calendar event series to one Docket process series. */
export const calendarProcessBinding = pgTable(
  'calendar_process_binding',
  {
    ...auditColumns(),
    calendarLayerId: text('calendar_layer_id')
      .notNull()
      .references(() => calendarLayer.id, { onDelete: 'cascade' }),
    externalSeriesId: text('external_series_id').notNull(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => processDefinition.id, { onDelete: 'restrict' }),
    seriesId: text('series_id')
      .notNull()
      .references(() => recurrenceSeries.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('calendar_process_binding_series_uq').on(
      t.organizationId,
      t.calendarLayerId,
      t.externalSeriesId,
    ),
    uniqueIndex('calendar_process_binding_recurrence_series_uq').on(t.seriesId),
    check(
      'calendar_process_binding_external_series_not_blank',
      sql`length(btrim(${t.externalSeriesId})) > 0`,
    ),
  ],
);
