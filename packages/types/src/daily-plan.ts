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
export const DailyPlanItemStatus = z
  .enum(['planned', 'done'])
  .describe(
    "A daily-plan item's completion state within the day: `planned` (pulled into the day, not yet finished) or `done` (checked off). This tracks the plan entry only and is independent of the referenced Task's own workflow state in its org.",
  );
/** Daily-plan-item-status value. */
export type DailyPlanItemStatus = z.infer<typeof DailyPlanItemStatus>;

/** Body for adding a Task reference to the caller's daily plan for a date. */
export const DailyPlanItemCreate = z
  .object({
    refOrganizationId: OrganizationId.describe(
      'The org that owns the referenced Task. Must be one of the orgs the caller is a human Actor in, and is validated together with `refTaskId` before insert (failing either check returns a single 404).',
    ),
    refTaskId: TaskId.describe(
      'The Task being pulled into the plan. Must exist within `refOrganizationId`. The pair `(refOrganizationId, refTaskId)` is the cross-org pointer; the plan item stores no copy of the Task.',
    ),
    date: z.iso
      .date()
      .describe(
        'The calendar day (ISO `YYYY-MM-DD`) this item is planned for. Items are grouped and read per date.',
      )
      .meta({ example: '2026-06-29' }),
    sort: z
      .number()
      .int()
      .optional()
      .describe(
        'Optional ordering position within the day (ascending). Omitted lets the server assign a default position; reads return items ordered by this.',
      ),
    timeboxStartsAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .describe(
        'Optional ISO-8601 start of a calendar timebox for this task. Set together with `timeboxEndsAt` to place the item on the Today calendar pane; null/omitted leaves it unscheduled.',
      ),
    timeboxEndsAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .describe(
        'Optional ISO-8601 end of the calendar timebox. Pairs with `timeboxStartsAt`; null/omitted leaves the item unscheduled.',
      ),
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
    status: DailyPlanItemStatus.optional().describe(
      'New completion state (`planned`/`done`). Omitted leaves the status unchanged (partial update).',
    ),
    sort: z
      .number()
      .int()
      .optional()
      .describe('New ordering position within the day. Omitted leaves the position unchanged.'),
    timeboxStartsAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .describe(
        'New ISO-8601 timebox start, or null to clear it. Omitted leaves it unchanged (partial update).',
      ),
    timeboxEndsAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .describe(
        'New ISO-8601 timebox end, or null to clear it. Omitted leaves it unchanged (partial update).',
      ),
  })
  .meta({ id: 'DailyPlanItemUpdate', description: 'Update a daily-plan item.' });
/** Validated daily-plan-item-update body. */
export type DailyPlanItemUpdate = z.infer<typeof DailyPlanItemUpdate>;

/** Full daily-plan-item representation returned by reads. */
export const DailyPlanItemOut = z
  .object({
    id: DailyPlanItemId.describe(
      "The daily-plan item's stable unique id (the handle for update/delete).",
    ),
    refOrganizationId: OrganizationId.describe(
      "The org that owns the referenced Task (the item's org chip).",
    ),
    refTaskId: TaskId.describe(
      'The referenced Task id. With `refOrganizationId` it forms the cross-org pointer to the underlying Task.',
    ),
    date: z.string().describe('The calendar day (ISO `YYYY-MM-DD`) this item is planned for.'),
    sort: z.number().int().describe("The item's ordering position within its day, ascending."),
    status: DailyPlanItemStatus.describe("The item's completion state (`planned`/`done`)."),
    timeboxStartsAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO-8601 start of the calendar timebox, or null when the item is unscheduled.'),
    timeboxEndsAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO-8601 end of the calendar timebox, or null when the item is unscheduled.'),
    createdAt: z.string().describe('ISO-8601 instant the item was added to the plan.'),
  })
  .meta({ id: 'DailyPlanItemOut', description: 'A Hub daily-plan item.' });
/** Daily-plan-item representation value. */
export type DailyPlanItemOut = z.infer<typeof DailyPlanItemOut>;
