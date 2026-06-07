/**
 * `@docket/types` — Milestone slice DTOs.
 */
import { z } from 'zod';

import { MilestoneId, OrganizationId, ProjectId } from './primitives';

/** Query params for listing Milestones (optionally narrowed to one Project). */
export const MilestoneListQuery = z
  .object({ projectId: ProjectId.optional() })
  .meta({ id: 'MilestoneListQuery', description: 'Filter milestones by project.' });
/** Validated milestone-list query value. */
export type MilestoneListQuery = z.infer<typeof MilestoneListQuery>;

/** Body for creating a Milestone (organizationId comes from the path, never the body). */
export const MilestoneCreate = z
  .object({
    projectId: ProjectId,
    name: z.string().min(1),
    targetDate: z.iso.date().optional(),
    sort: z.number().int().optional(),
  })
  .meta({ id: 'MilestoneCreate', description: 'Create a milestone within an organization.' });
/** Validated milestone-create body. */
export type MilestoneCreate = z.infer<typeof MilestoneCreate>;

/** Body for updating a Milestone (all fields optional; the project is fixed at creation). */
export const MilestoneUpdate = z
  .object({
    name: z.string().min(1).optional(),
    targetDate: z.iso.date().nullable().optional(),
    sort: z.number().int().optional(),
  })
  .meta({ id: 'MilestoneUpdate', description: 'Update a milestone.' });
/** Validated milestone-update body. */
export type MilestoneUpdate = z.infer<typeof MilestoneUpdate>;

/** Full milestone representation returned by reads. */
export const MilestoneOut = z
  .object({
    id: MilestoneId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    name: z.string(),
    targetDate: z.string().nullable().optional(),
    sort: z.number().int(),
    createdAt: z.string(),
  })
  .meta({ id: 'MilestoneOut', description: 'A milestone.' });
/** Milestone representation value. */
export type MilestoneOut = z.infer<typeof MilestoneOut>;
