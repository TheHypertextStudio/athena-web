/**
 * `@docket/api` — the commands and results the process materializer passes between its layers.
 *
 * @remarks
 * `./materialize` owns the occurrence and instance rows; `./materialize-steps` turns a revision's
 * steps into concrete work inside one. They exchange these shapes, so the shapes live in neither.
 */
import type { Database } from '@docket/db';

import type { TaskStateMutation } from '../task-state';

/** Transaction handle shared with completion advancement. */
export type ProcessTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Command for ensuring and materializing one expected process occurrence. */
export interface MaterializeOccurrenceCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with generated work. */
  readonly actorId?: string | undefined;
  /** Recurrence series being executed. */
  readonly seriesId: string;
  /** Immutable schedule/process binding selected for this occurrence. */
  readonly seriesRevisionId: string;
  /** Expected civil date. */
  readonly scheduledFor: string;
  /** Original date when this is a rescheduled occurrence. */
  readonly originalScheduledFor?: string | undefined;
  /** Stable provider-side occurrence key for calendar-bound runs. */
  readonly externalOccurrenceKey?: string | undefined;
}

/** Complete identity map for one materialized process occurrence. */
export interface MaterializedOccurrence {
  /** Durable expected occurrence id. */
  readonly occurrenceId: string;
  /** Concrete process execution id. */
  readonly instanceId: string;
  /** Generated Projects keyed by authored step key. */
  readonly projectIdsByKey: Readonly<Record<string, string>>;
  /** Generated Milestones keyed by authored step key. */
  readonly milestoneIdsByKey: Readonly<Record<string, string>>;
  /** Generated Tasks keyed by authored step key. */
  readonly taskIdsByKey: Readonly<Record<string, string>>;
}

/** Newly generated entity identities from one readiness pass. */
export interface MaterializedStepDelta {
  /** Projects created by this pass. */
  readonly createdProjectIdsByKey: Readonly<Record<string, string>>;
  /** Milestones created by this pass. */
  readonly createdMilestoneIdsByKey: Readonly<Record<string, string>>;
  /** Tasks created by this pass. */
  readonly createdTaskIdsByKey: Readonly<Record<string, string>>;
}

/** Context for a readiness pass inside an already locked instance transaction. */
export interface MaterializeInstanceStepsCommand {
  /** Owning workspace. */
  readonly organizationId: string;
  /** Actor credited with newly generated entities. */
  readonly actorId?: string | undefined;
  /** Existing process instance. */
  readonly instanceId: string;
  /** Immutable process revision. */
  readonly revisionId: string;
  /** Civil date that triggered the occurrence. */
  readonly scheduledFor: string;
  /** Exact completion dates observed during this transition, keyed by source step id. */
  readonly completionDatesByStepId?: ReadonlyMap<string, string> | undefined;
  /** State changes that the caller must publish after its enclosing transaction commits. */
  readonly postCommitStateTransitions?: TaskStateMutation[] | undefined;
}
