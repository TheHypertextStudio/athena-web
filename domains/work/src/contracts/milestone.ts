/**
 * `domain packages` — Milestone slice DTOs.
 */
import { z } from 'zod';

import { MilestoneId, ProjectId } from '../ids';
import { OrganizationId } from '@docket/identity-access/ids';

/**
 * Body for creating a Milestone.
 *
 * @remarks
 * Carries no `projectId`: a milestone is created at its Project's own collection, so the parent
 * comes from the path, exactly as the organization does. The parent is fixed at creation —
 * `MilestoneUpdate` has no `projectId` either, so a milestone cannot be re-parented.
 */
export const MilestoneCreate = z
  .object({
    name: z
      .string()
      .min(1)
      .describe('Human-readable milestone label (e.g. "Beta", "GA"). Required, non-empty.'),
    description: z
      .string()
      .optional()
      .describe('Optional long-form note for the milestone. Omit for none.'),
    targetDate: z.iso
      .date()
      .optional()
      .describe(
        'Planned completion date (ISO-8601 `YYYY-MM-DD`). Drives the milestone’s on-track/at-risk signal relative to today. Omit for an undated checkpoint.',
      ),
    sort: z
      .number()
      .int()
      .optional()
      .describe(
        'Manual ordering key among the project’s milestones (ascending); lists order by this, not by date. Omit it to append after the project’s current last milestone — a client adding checkpoints one at a time never has to compute a position from a list it may have read some time ago.',
      ),
  })
  .meta({ id: 'MilestoneCreate', description: 'Create a milestone within an organization.' });
/** Validated milestone-create body. */
export type MilestoneCreate = z.infer<typeof MilestoneCreate>;

/** Body for updating a Milestone (all fields optional; the project is fixed at creation). */
export const MilestoneUpdate = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'New milestone label. Omit to leave the name unchanged; must be non-empty when set.',
      ),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('New long-form note. Omit to leave unchanged; pass `null` to clear it.'),
    targetDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        'New planned completion date (ISO-8601 `YYYY-MM-DD`). Omit to leave unchanged; pass `null` to clear the date (undated checkpoint).',
      ),
    sort: z
      .number()
      .int()
      .optional()
      .describe(
        'New ordering key among siblings (ascending). Omit to leave the position unchanged.',
      ),
  })
  .meta({ id: 'MilestoneUpdate', description: 'Update a milestone.' });
/** Validated milestone-update body. */
export type MilestoneUpdate = z.infer<typeof MilestoneUpdate>;

/** Full milestone representation returned by reads. */
export const MilestoneOut = z
  .object({
    id: MilestoneId.describe('Stable unique identifier of the milestone.'),
    organizationId: OrganizationId.describe(
      'The owning organization (tenant) — milestones are org-scoped.',
    ),
    projectId: ProjectId.describe(
      'The Project this milestone belongs to. Immutable after creation.',
    ),
    name: z.string().describe('Human-readable milestone label.'),
    description: z
      .string()
      .nullable()
      .describe('Long-form note for the milestone, or `null` when none is set.'),
    targetDate: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Planned completion date (ISO-8601 string), or `null` when the milestone is undated. Drives the on-track/at-risk signal relative to today.',
      ),
    sort: z
      .number()
      .int()
      .describe(
        'Manual ordering key among the project’s milestones (ascending); the order they render on the timeline.',
      ),
    createdAt: z.string().describe('When the milestone was created (ISO-8601 timestamp).'),
  })
  .meta({ id: 'MilestoneOut', description: 'A milestone.' });
/** Milestone representation value. */
export type MilestoneOut = z.infer<typeof MilestoneOut>;
