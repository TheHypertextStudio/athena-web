/**
 * `@docket/types` — Label slice DTOs.
 */
import { z } from 'zod';

import { LabelId, OrganizationId, TeamId } from './primitives';

/** Body for creating a Label; org-global when `teamId` is omitted, else team-scoped. */
export const LabelCreate = z
  .object({
    name: z.string().min(1),
    color: z.string().min(1),
    group: z.string().nullable().optional(),
    teamId: TeamId.optional(),
  })
  .meta({ id: 'LabelCreate', description: 'Create a label within an organization.' });
/** Validated label-create body. */
export type LabelCreate = z.infer<typeof LabelCreate>;

/** Body for updating a Label (all fields optional). */
export const LabelUpdate = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    group: z.string().nullable().optional(),
    teamId: TeamId.nullable().optional(),
  })
  .meta({ id: 'LabelUpdate', description: 'Update a label.' });
/** Validated label-update body. */
export type LabelUpdate = z.infer<typeof LabelUpdate>;

/** Full label representation returned by reads. */
export const LabelOut = z
  .object({
    id: LabelId,
    organizationId: OrganizationId,
    name: z.string(),
    color: z.string(),
    group: z.string().nullable().optional(),
    teamId: TeamId.nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'LabelOut', description: 'A label.' });
/** Label representation value. */
export type LabelOut = z.infer<typeof LabelOut>;
