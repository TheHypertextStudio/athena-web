/**
 * `@docket/types` — Daily-plan slice DTOs.
 *
 * @remarks
 * A daily-plan item is a Hub-scoped (personal, cross-org) entry referencing a Task in
 * any of the caller's organizations for a given calendar `date`. The owning `hubId` is
 * resolved server-side from the session user's Hub, never supplied by the body; the
 * task reference is `(refOrganizationId, refTaskId)`. Items carry a sort position, a
 * planned/done status, and an optional calendar timebox.
 */
import { z } from 'zod';

import { DailyPlanItemId, OrganizationId, TaskId } from './primitives';

/** Status of a Hub daily-plan item. */
export const DailyPlanItemStatus = z.enum(['planned', 'done']);
/** Daily-plan-item-status value. */
export type DailyPlanItemStatus = z.infer<typeof DailyPlanItemStatus>;

/** Body for adding a Task reference to the caller's daily plan for a date. */
export const DailyPlanItemCreate = z
  .object({
    refOrganizationId: OrganizationId,
    refTaskId: TaskId,
    date: z.iso.date(),
    sort: z.number().int().optional(),
    timeboxStartsAt: z.iso.datetime().nullable().optional(),
    timeboxEndsAt: z.iso.datetime().nullable().optional(),
  })
  .meta({
    id: 'DailyPlanItemCreate',
    description: "Add a task reference to the caller's daily plan.",
  });
/** Validated daily-plan-item-create body. */
export type DailyPlanItemCreate = z.infer<typeof DailyPlanItemCreate>;

/** Body for updating a daily-plan item's status, sort position, or timebox. */
export const DailyPlanItemUpdate = z
  .object({
    status: DailyPlanItemStatus.optional(),
    sort: z.number().int().optional(),
    timeboxStartsAt: z.iso.datetime().nullable().optional(),
    timeboxEndsAt: z.iso.datetime().nullable().optional(),
  })
  .meta({ id: 'DailyPlanItemUpdate', description: 'Update a daily-plan item.' });
/** Validated daily-plan-item-update body. */
export type DailyPlanItemUpdate = z.infer<typeof DailyPlanItemUpdate>;

/** Full daily-plan-item representation returned by reads. */
export const DailyPlanItemOut = z
  .object({
    id: DailyPlanItemId,
    refOrganizationId: OrganizationId,
    refTaskId: TaskId,
    date: z.string(),
    sort: z.number().int(),
    status: DailyPlanItemStatus,
    timeboxStartsAt: z.string().nullable().optional(),
    timeboxEndsAt: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'DailyPlanItemOut', description: 'A Hub daily-plan item.' });
/** Daily-plan-item representation value. */
export type DailyPlanItemOut = z.infer<typeof DailyPlanItemOut>;
