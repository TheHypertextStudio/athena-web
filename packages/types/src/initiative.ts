/**
 * `@docket/types` — Initiative slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { ActorId, InitiativeId, OrganizationId } from './primitives';

/** Initiative (theme) status. */
export const InitiativeStatus = z.enum(['active', 'completed']);
/** Initiative status value. */
export type InitiativeStatus = z.infer<typeof InitiativeStatus>;

/** Body for creating an Initiative (organizationId comes from the path, never the body). */
export const InitiativeCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    ownerId: ActorId.optional(),
    status: InitiativeStatus.optional(),
    targetDate: z.iso.date().optional(),
    health: Health.optional(),
  })
  .meta({ id: 'InitiativeCreate', description: 'Create an initiative within an organization.' });
/** Validated initiative-create body. */
export type InitiativeCreate = z.infer<typeof InitiativeCreate>;

/** Body for updating an Initiative (all fields optional). */
export const InitiativeUpdate = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: InitiativeStatus.optional(),
    targetDate: z.iso.date().nullable().optional(),
    health: Health.nullable().optional(),
  })
  .meta({ id: 'InitiativeUpdate', description: 'Update an initiative.' });
/** Validated initiative-update body. */
export type InitiativeUpdate = z.infer<typeof InitiativeUpdate>;

/** Full initiative representation returned by reads. */
export const InitiativeOut = z
  .object({
    id: InitiativeId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: InitiativeStatus,
    targetDate: z.string().nullable().optional(),
    health: Health.nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'InitiativeOut', description: 'An initiative.' });
/** Initiative representation value. */
export type InitiativeOut = z.infer<typeof InitiativeOut>;
