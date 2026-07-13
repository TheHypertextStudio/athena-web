/**
 * `@docket/types` — Time Ledger DTOs.
 *
 * @remarks
 * The Time Ledger records actual, actor-attributed intervals independently from task workflow,
 * calendar planning, and agent-session lifetime. A {@link TimeRecordOut} is the human-visible
 * unit of work; {@link TimeIntervalOut} rows are the authoritative duration facts.
 */
import { z } from 'zod';

import { EntityRef } from './event';
import {
  AgentExecutionId,
  AgentSessionId,
  HubId,
  OrganizationId,
  TimeAllocationId,
  TimeCategoryId,
  TimeContextId,
  TimeIntervalId,
  TimeRecordId,
  TimeSubmissionId,
  TimeSubmissionItemId,
} from './primitives';

/** User-visible lifecycle state for a time record. */
export const TimeRecordStatus = z.enum(['open', 'paused', 'closed', 'submitted', 'superseded']);
/** Time-record-status value. */
export type TimeRecordStatus = z.infer<typeof TimeRecordStatus>;

/** How a record was initially captured. */
export const TimeCaptureSource = z.enum(['live', 'manual', 'reconstructed', 'agent']);
/** Time-capture-source value. */
export type TimeCaptureSource = z.infer<typeof TimeCaptureSource>;

/** Actor responsible for an interval. */
export const TimeIntervalActorKind = z.enum(['human', 'agent']);
/** Time-interval-actor-kind value. */
export type TimeIntervalActorKind = z.infer<typeof TimeIntervalActorKind>;

/** The work mode represented by an exact interval. */
export const TimeIntervalMode = z.enum([
  'human_active',
  'agent_active',
  'tool_wait',
  'awaiting_human',
]);
/** Time-interval-mode value. */
export type TimeIntervalMode = z.infer<typeof TimeIntervalMode>;

/** Provenance for interval timestamps. */
export const TimeIntervalSource = z.enum([
  'user_timer',
  'manual_entry',
  'reconstructed_entry',
  'agent_runtime',
]);
/** Time-interval-source value. */
export type TimeIntervalSource = z.infer<typeof TimeIntervalSource>;

/** Relationship role for a typed, non-counting time context. */
export const TimeContextRole = z.enum([
  'primary',
  'related',
  'calendar_context',
  'planning_context',
  'agent_context',
]);
/** Time-context-role value. */
export type TimeContextRole = z.infer<typeof TimeContextRole>;

/** Target kinds eligible for explicit reportable allocations. */
export const TimeAllocationTargetKind = z.enum(['task', 'workspace', 'project', 'category']);
/** Time-allocation-target-kind value. */
export type TimeAllocationTargetKind = z.infer<typeof TimeAllocationTargetKind>;

/** Lifecycle state for one agent-runtime dispatch beneath a durable session. */
export const AgentExecutionStatus = z.enum([
  'queued',
  'running',
  'tool_wait',
  'awaiting_human',
  'completed',
  'failed',
  'canceled',
]);
/** Agent-execution-status value. */
export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatus>;

/** A typed input supplied by any surface that can start tracking. */
export const TrackableContext = z
  .object({
    label: z.string().trim().min(1).max(500),
    primaryRef: EntityRef.optional(),
    workspaceRef: EntityRef.optional(),
    contextualRefs: z.array(EntityRef).max(20).default([]),
    suggestedCategoryId: TimeCategoryId.optional(),
  })
  .meta({ id: 'TrackableContext', description: 'Typed context used to begin a Time Record.' });
/** Trackable-context value. */
export type TrackableContext = z.infer<typeof TrackableContext>;

/** One exact actor-attributed interval in a Time Record. */
export const TimeIntervalOut = z
  .object({
    id: TimeIntervalId,
    timeRecordId: TimeRecordId,
    actorKind: TimeIntervalActorKind,
    userId: z.string().nullable(),
    agentExecutionId: AgentExecutionId.nullable(),
    mode: TimeIntervalMode,
    source: TimeIntervalSource,
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    supersededById: TimeIntervalId.nullable(),
    createdAt: z.string(),
    closedAt: z.string().nullable(),
  })
  .meta({ id: 'TimeIntervalOut', description: 'One exact measured Time Ledger interval.' });
/** Time-interval-out value. */
export type TimeIntervalOut = z.infer<typeof TimeIntervalOut>;

/** A typed, non-counting link between a record and Docket context. */
export const TimeContextOut = z
  .object({
    id: TimeContextId,
    timeRecordId: TimeRecordId,
    role: TimeContextRole,
    entityRef: EntityRef,
    organizationId: OrganizationId.nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'TimeContextOut', description: 'A typed non-counting Time Record context.' });
/** Time-context-out value. */
export type TimeContextOut = z.infer<typeof TimeContextOut>;

/** One explicit reportable share of a Time Record. */
export const TimeAllocationOut = z
  .object({
    id: TimeAllocationId,
    timeRecordId: TimeRecordId,
    targetKind: TimeAllocationTargetKind,
    targetId: z.string(),
    organizationId: OrganizationId.nullable(),
    basisPoints: z.number().int().min(0).max(10_000),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'TimeAllocationOut', description: 'An explicit reportable Time Record allocation.' });
/** Time-allocation-out value. */
export type TimeAllocationOut = z.infer<typeof TimeAllocationOut>;

/** Exact calculated measures for a record or aggregation bucket. */
export const TimeMeasuresOut = z
  .object({
    elapsedMs: z.number().int().nonnegative(),
    humanEffortMs: z.number().int().nonnegative(),
    agentEffortMs: z.number().int().nonnegative(),
    combinedEffortMs: z.number().int().nonnegative(),
    operationalWaitMs: z.number().int().nonnegative(),
  })
  .meta({ id: 'TimeMeasuresOut', description: 'Labeled Time Ledger duration measures.' });
/** Time-measures-out value. */
export type TimeMeasuresOut = z.infer<typeof TimeMeasuresOut>;

/** Full personal Time Record detail. */
export const TimeRecordOut = z
  .object({
    id: TimeRecordId,
    hubId: HubId,
    title: z.string(),
    outcomeNote: z.string().nullable(),
    status: TimeRecordStatus,
    categoryId: TimeCategoryId.nullable(),
    captureSource: TimeCaptureSource,
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    closedAt: z.string().nullable(),
    intervals: z.array(TimeIntervalOut),
    contexts: z.array(TimeContextOut),
    allocations: z.array(TimeAllocationOut),
    measures: TimeMeasuresOut,
  })
  .meta({ id: 'TimeRecordOut', description: 'A Hub-owned unit of tracked work.' });
/** Time-record-out value. */
export type TimeRecordOut = z.infer<typeof TimeRecordOut>;

/** Response for the shell's active tracker. */
export const TimeActiveOut = z
  .object({
    record: TimeRecordOut.nullable(),
    serverNow: z.string(),
    activeAgentExecutions: z.array(
      z.object({
        id: AgentExecutionId,
        sessionId: AgentSessionId,
        timeRecordId: TimeRecordId.nullable(),
        status: AgentExecutionStatus,
        startedAt: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'TimeActiveOut', description: 'The caller’s active human tracker and agents.' });
/** Time-active-out value. */
export type TimeActiveOut = z.infer<typeof TimeActiveOut>;

/** Body for creating a live or manual Time Record. */
export const TimeRecordCreate = z
  .object({
    context: TrackableContext,
    captureSource: TimeCaptureSource.optional(),
    startNow: z.boolean().optional().default(true),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startNow && (value.startsAt || value.endsAt)) {
      ctx.addIssue({ code: 'custom', message: 'Live tracking cannot supply historical bounds.' });
    }
    if (!value.startNow && (!value.startsAt || !value.endsAt)) {
      ctx.addIssue({ code: 'custom', message: 'Manual time requires both start and end.' });
    }
    if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      ctx.addIssue({ code: 'custom', message: 'The end must be after the start.' });
    }
  })
  .meta({ id: 'TimeRecordCreate', description: 'Create a live or historical Time Record.' });
/** Time-record-create value. */
export type TimeRecordCreate = z.infer<typeof TimeRecordCreate>;

/** Editable semantic fields on a Time Record. */
export const TimeRecordUpdate = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    outcomeNote: z.string().trim().max(5_000).nullable().optional(),
    categoryId: TimeCategoryId.nullable().optional(),
  })
  .meta({ id: 'TimeRecordUpdate', description: 'Edit a Time Record’s semantic fields.' });
/** Time-record-update value. */
export type TimeRecordUpdate = z.infer<typeof TimeRecordUpdate>;

/** Body for a deliberate historical/reconstructed interval. */
export const TimeIntervalCreate = z
  .object({
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    source: z.enum(['manual_entry', 'reconstructed_entry']).default('manual_entry'),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: 'The end must be after the start.',
  })
  .meta({ id: 'TimeIntervalCreate', description: 'Add exact historical time to a record.' });
/** Time-interval-create value. */
export type TimeIntervalCreate = z.infer<typeof TimeIntervalCreate>;

/** One context link supplied by the record-detail editor. */
export const TimeContextCreate = z
  .object({
    role: TimeContextRole,
    entityRef: EntityRef,
    organizationId: OrganizationId.nullable().optional(),
  })
  .meta({ id: 'TimeContextCreate', description: 'Attach typed context to a Time Record.' });
/** Time-context-create value. */
export type TimeContextCreate = z.infer<typeof TimeContextCreate>;

/** A replacement allocation set; reportable sets must sum to 10,000 basis points. */
export const TimeAllocationReplace = z
  .object({
    allocations: z
      .array(
        z.object({
          targetKind: TimeAllocationTargetKind,
          targetId: z.string().min(1),
          organizationId: OrganizationId.nullable().optional(),
          basisPoints: z.number().int().min(0).max(10_000),
        }),
      )
      .max(20),
  })
  .superRefine((value, ctx) => {
    if (value.allocations.length > 0) {
      const total = value.allocations.reduce((sum, allocation) => sum + allocation.basisPoints, 0);
      if (total !== 10_000) {
        ctx.addIssue({ code: 'custom', message: 'Allocations must sum to 10,000 basis points.' });
      }
    }
  })
  .meta({ id: 'TimeAllocationReplace', description: 'Replace a Time Record allocation set.' });
/** Time-allocation-replace value. */
export type TimeAllocationReplace = z.infer<typeof TimeAllocationReplace>;

/** Bounded personal Time Ledger timeline query. */
export const TimeTimelineQuery = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  })
  .refine((value) => Date.parse(value.end) > Date.parse(value.start), {
    message: 'The end must be after the start.',
  })
  .meta({ id: 'TimeTimelineQuery', description: 'A bounded Time Ledger timeline query.' });
/** Time-timeline-query value. */
export type TimeTimelineQuery = z.infer<typeof TimeTimelineQuery>;

/** The personal Time Timeline response. */
export const TimeTimelineOut = z
  .object({
    items: z.array(TimeRecordOut),
  })
  .meta({ id: 'TimeTimelineOut', description: 'The caller’s personal Time Ledger timeline.' });
/** Time-timeline-out value. */
export type TimeTimelineOut = z.infer<typeof TimeTimelineOut>;

/** Supported dimensions for Time Ledger reflection breakdowns. */
export const TimeBreakdownDimension = z.enum(['workspace', 'task', 'project', 'category', 'actor']);
/** Time-breakdown-dimension value. */
export type TimeBreakdownDimension = z.infer<typeof TimeBreakdownDimension>;

/** Bounded breakdown query; allocations drive workspace/task/project credit. */
export const TimeBreakdownQuery = TimeTimelineQuery.extend({
  groupBy: TimeBreakdownDimension,
}).meta({
  id: 'TimeBreakdownQuery',
  description: 'Group personal Time Ledger effort by a dimension.',
});
/** Time-breakdown-query value. */
export type TimeBreakdownQuery = z.infer<typeof TimeBreakdownQuery>;

/** One labeled bucket in a Time Ledger breakdown. */
export const TimeBreakdownBucketOut = z
  .object({
    key: z.string(),
    label: z.string(),
    measures: TimeMeasuresOut,
  })
  .meta({ id: 'TimeBreakdownBucketOut', description: 'One Time Ledger aggregation bucket.' });
/** Time-breakdown-bucket-out value. */
export type TimeBreakdownBucketOut = z.infer<typeof TimeBreakdownBucketOut>;

/** Grouped Time Ledger reflection response. */
export const TimeBreakdownOut = z
  .object({
    groupBy: TimeBreakdownDimension,
    buckets: z.array(TimeBreakdownBucketOut),
    total: TimeMeasuresOut,
  })
  .meta({ id: 'TimeBreakdownOut', description: 'Personal Time Ledger breakdown.' });
/** Time-breakdown-out value. */
export type TimeBreakdownOut = z.infer<typeof TimeBreakdownOut>;

/** User-owned time category. */
export const TimeCategoryOut = z
  .object({
    id: TimeCategoryId,
    hubId: HubId,
    parentId: TimeCategoryId.nullable(),
    name: z.string(),
    color: z.string().nullable(),
    sort: z.number().int(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'TimeCategoryOut', description: 'A Hub-owned Time Ledger category.' });
/** Time-category-out value. */
export type TimeCategoryOut = z.infer<typeof TimeCategoryOut>;

/** List response for the caller’s personal time taxonomy. */
export const TimeCategoryListOut = z
  .object({ items: z.array(TimeCategoryOut) })
  .meta({ id: 'TimeCategoryListOut', description: 'The caller’s Hub-owned time categories.' });
/** Time-category-list-out value. */
export type TimeCategoryListOut = z.infer<typeof TimeCategoryListOut>;

/** Body for a user-created time category. */
export const TimeCategoryCreate = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z.string().trim().max(32).nullable().optional(),
    parentId: TimeCategoryId.nullable().optional(),
    sort: z.number().int().optional(),
  })
  .meta({ id: 'TimeCategoryCreate', description: 'Create a Hub-owned time category.' });
/** Time-category-create value. */
export type TimeCategoryCreate = z.infer<typeof TimeCategoryCreate>;

/** The measure a submission makes visible to its recipient. */
export const TimeSubmissionMeasure = z.enum([
  'human_effort',
  'agent_effort',
  'combined_effort',
  'elapsed_delivery',
]);
/** Time-submission-measure value. */
export type TimeSubmissionMeasure = z.infer<typeof TimeSubmissionMeasure>;

/** One immutable snapshot row inside a Time Submission. */
export const TimeSubmissionItemOut = z
  .object({
    id: TimeSubmissionItemId,
    timeRecordId: TimeRecordId,
    allocationId: TimeAllocationId.nullable(),
    targetKind: TimeAllocationTargetKind.nullable(),
    targetId: z.string().nullable(),
    basisPoints: z.number().int().min(0).max(10_000),
    durationMs: z.number().int().nonnegative(),
  })
  .meta({ id: 'TimeSubmissionItemOut', description: 'Immutable submitted Time Ledger credit.' });
/** Time-submission-item-out value. */
export type TimeSubmissionItemOut = z.infer<typeof TimeSubmissionItemOut>;

/** Explicit, recipient-scoped Time Ledger report snapshot. */
export const TimeSubmissionOut = z
  .object({
    id: TimeSubmissionId,
    hubId: HubId,
    organizationId: OrganizationId.nullable(),
    status: z.enum(['draft', 'submitted', 'withdrawn']),
    periodStartsAt: z.string(),
    periodEndsAt: z.string(),
    timezone: z.string(),
    measure: TimeSubmissionMeasure,
    roundingPolicy: z.string(),
    submittedAt: z.string().nullable(),
    withdrawnAt: z.string().nullable(),
    createdAt: z.string(),
    items: z.array(TimeSubmissionItemOut),
  })
  .meta({ id: 'TimeSubmissionOut', description: 'An explicit Time Ledger report submission.' });
/** Time-submission-out value. */
export type TimeSubmissionOut = z.infer<typeof TimeSubmissionOut>;

/** Recipient-safe submitted credit: a workspace never receives a private record identifier. */
export const TimeSubmissionRecipientItemOut = z
  .object({
    targetKind: TimeAllocationTargetKind.nullable(),
    targetId: z.string().nullable(),
    basisPoints: z.number().int().min(0).max(10_000),
    durationMs: z.number().int().nonnegative(),
  })
  .meta({
    id: 'TimeSubmissionRecipientItemOut',
    description: 'Recipient-safe immutable submitted time credit.',
  });
/** Recipient-safe submitted credit value. */
export type TimeSubmissionRecipientItemOut = z.infer<typeof TimeSubmissionRecipientItemOut>;

/** A recipient-scoped time report without private Hub or Time Record identifiers. */
export const TimeSubmissionRecipientOut = z
  .object({
    id: TimeSubmissionId,
    organizationId: OrganizationId,
    status: z.literal('submitted'),
    periodStartsAt: z.string(),
    periodEndsAt: z.string(),
    timezone: z.string(),
    measure: TimeSubmissionMeasure,
    roundingPolicy: z.string(),
    submittedAt: z.string(),
    items: z.array(TimeSubmissionRecipientItemOut),
  })
  .meta({
    id: 'TimeSubmissionRecipientOut',
    description: 'A workspace-visible, recipient-scoped time report snapshot.',
  });
/** Recipient-scoped time report snapshot value. */
export type TimeSubmissionRecipientOut = z.infer<typeof TimeSubmissionRecipientOut>;

/** List response for recipient-scoped workspace time reports. */
export const TimeSubmissionRecipientListOut = z
  .object({ items: z.array(TimeSubmissionRecipientOut) })
  .meta({
    id: 'TimeSubmissionRecipientListOut',
    description: 'Workspace-visible submitted time report snapshots.',
  });
/** Recipient-scoped report list value. */
export type TimeSubmissionRecipientListOut = z.infer<typeof TimeSubmissionRecipientListOut>;

/** Body for creating an immutable submitted time-report snapshot. */
export const TimeSubmissionCreate = z
  .object({
    organizationId: OrganizationId.nullable().optional(),
    periodStartsAt: z.iso.datetime(),
    periodEndsAt: z.iso.datetime(),
    timezone: z.string().trim().min(1).max(100),
    measure: TimeSubmissionMeasure,
    roundingPolicy: z.string().trim().min(1).max(80).optional().default('none'),
    timeRecordIds: z.array(TimeRecordId).min(1).max(500),
  })
  .refine((value) => Date.parse(value.periodEndsAt) > Date.parse(value.periodStartsAt), {
    message: 'The submission period end must be after its start.',
  })
  .meta({ id: 'TimeSubmissionCreate', description: 'Create an explicit time-report submission.' });
/** Time-submission-create value. */
export type TimeSubmissionCreate = z.infer<typeof TimeSubmissionCreate>;
