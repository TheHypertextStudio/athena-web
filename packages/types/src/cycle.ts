/**
 * `@docket/types` — Cycle slice DTOs.
 */
import { z } from 'zod';

import { CycleId, OrganizationId, TeamId } from './primitives';

/** Cycle (team cadence) status. */
export const CycleStatus = z.enum(['upcoming', 'active', 'completed']);
/** Cycle status value. */
export type CycleStatus = z.infer<typeof CycleStatus>;

/** Body for creating a Cycle (organizationId comes from the path, never the body). */
export const CycleCreate = z
  .object({
    teamId: TeamId,
    number: z.number().int(),
    name: z.string().min(1).optional(),
    startsAt: z.iso.date(),
    endsAt: z.iso.date(),
    status: CycleStatus.optional(),
  })
  .meta({ id: 'CycleCreate', description: 'Create a cycle within an organization.' });
/** Validated cycle-create body. */
export type CycleCreate = z.infer<typeof CycleCreate>;

/** Body for updating a Cycle (all fields optional; the team is fixed at creation). */
export const CycleUpdate = z
  .object({
    number: z.number().int().optional(),
    name: z.string().min(1).nullable().optional(),
    startsAt: z.iso.date().optional(),
    endsAt: z.iso.date().optional(),
    status: CycleStatus.optional(),
  })
  .meta({ id: 'CycleUpdate', description: 'Update a cycle.' });
/** Validated cycle-update body. */
export type CycleUpdate = z.infer<typeof CycleUpdate>;

/** Full cycle representation returned by reads. */
export const CycleOut = z
  .object({
    id: CycleId,
    organizationId: OrganizationId,
    teamId: TeamId,
    number: z.number().int(),
    name: z.string().nullable().optional(),
    startsAt: z.string(),
    endsAt: z.string(),
    status: CycleStatus,
    createdAt: z.string(),
  })
  .meta({ id: 'CycleOut', description: 'A cycle.' });
/** Cycle representation value. */
export type CycleOut = z.infer<typeof CycleOut>;
