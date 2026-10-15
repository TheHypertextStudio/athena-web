import { z } from 'zod';
import { ActorOut } from '@docket/identity-access/actor-contract';
import { ProjectId, MilestoneId } from '../ids';
import { DateString, TimestampString } from '../view-date';
const nullableDate = DateString.nullable();
const ratio = z.number().min(0).max(1);

/** Dated Project checkpoint retained by the timeline projection. */
export const ProjectViewMilestone = z
  .object({ id: MilestoneId, name: z.string(), targetDate: nullableDate })
  .strict();
/** A validated Project checkpoint in a work-view row. */
export type ProjectViewMilestone = z.infer<typeof ProjectViewMilestone>;

/** Contributing Project schedule retained by an Initiative timeline rollup. */
export const InitiativeContributingProject = z
  .object({
    id: ProjectId,
    name: z.string(),
    startDate: nullableDate,
    targetDate: nullableDate,
    progress: ratio,
  })
  .strict();
/** A validated contributing Project schedule in an Initiative work-view row. */
export type InitiativeContributingProject = z.infer<typeof InitiativeContributingProject>;

/** Resolved actor identity carried only to roster presentation. */
export const WorkViewActor = ActorOut.pick({
  id: true,
  kind: true,
  displayName: true,
  avatar: true,
}).strict();
/** A resolved actor identity for a work-view row. */
export type WorkViewActor = z.infer<typeof WorkViewActor>;

/** A fixed oldest-to-newest eight-week summary of visible Program activity. */
export const ProgramActivitySummary = z
  .object({
    weeks: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    latestOccurredAt: TimestampString.nullable(),
  })
  .strict();
/** A validated fixed-window Program activity summary. */
export type ProgramActivitySummary = z.infer<typeof ProgramActivitySummary>;
