/**
 * `@docket/types` — Program slice DTOs.
 */
import { z } from 'zod';

import { Health, Visibility } from './capability';
import { ActorId, OrganizationId, ProgramId } from './primitives';

/** Program status — Programs are ongoing, so there is intentionally NO `completed`. */
export const ProgramStatus = z.enum(['active', 'paused', 'archived']);
/** Program status value. */
export type ProgramStatus = z.infer<typeof ProgramStatus>;

/** Body for creating a Program (organizationId comes from the path, never the body). */
export const ProgramCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    ownerId: ActorId.optional(),
    status: ProgramStatus.optional(),
    health: Health.optional(),
    visibility: Visibility.optional(),
  })
  .meta({ id: 'ProgramCreate', description: 'Create a program within an organization.' });
/** Validated program-create body. */
export type ProgramCreate = z.infer<typeof ProgramCreate>;

/** Body for updating a Program (all fields optional). */
export const ProgramUpdate = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: ProgramStatus.optional(),
    health: Health.nullable().optional(),
    visibility: Visibility.optional(),
  })
  .meta({ id: 'ProgramUpdate', description: 'Update a program.' });
/** Validated program-update body. */
export type ProgramUpdate = z.infer<typeof ProgramUpdate>;

/** Full program representation returned by reads. */
export const ProgramOut = z
  .object({
    id: ProgramId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: ProgramStatus,
    health: Health.nullable().optional(),
    visibility: Visibility,
    createdAt: z.string(),
  })
  .meta({ id: 'ProgramOut', description: 'A program.' });
/** Program representation value. */
export type ProgramOut = z.infer<typeof ProgramOut>;
