/**
 * `@docket/types` — Milestone slice DTOs.
 */
import { z } from 'zod';

import { MilestoneId, OrganizationId, ProjectId } from './primitives';

/** Query params for listing Milestones (optionally narrowed to one Project). */
export const MilestoneListQuery = z
  .object({
    projectId: ProjectId.optional().describe(
      'Narrow the list to a single Project’s milestones. Omit to list every milestone in the organization. When supplied, only milestones whose `projectId` matches are returned, still ordered by `sort` ascending.',
    ),
  })
  .meta({ id: 'MilestoneListQuery', description: 'Filter milestones by project.' });
/** Validated milestone-list query value. */
export type MilestoneListQuery = z.infer<typeof MilestoneListQuery>;

/** Body for creating a Milestone (organizationId comes from the path, never the body). */
export const MilestoneCreate = z
  .object({
    projectId: ProjectId.describe(
      'The parent Project this milestone belongs to (required). Re-validated to live in the caller’s org before insert (404 when cross-tenant). Fixed at creation — a milestone cannot be re-parented later.',
    ),
    name: z
      .string()
      .min(1)
      .describe('Human-readable milestone label (e.g. "Beta", "GA"). Required, non-empty.'),
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
        'Manual ordering key among the project’s milestones (ascending). Defaults to `0` when omitted; lists order by this, not by date.',
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
