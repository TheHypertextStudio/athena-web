/**
 * `@docket/types` — Project slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { ActorId, InitiativeId, OrganizationId, ProgramId, ProjectId, TeamId } from './primitives';

/** Body for creating a Project (organizationId comes from the path, never the body). */
export const ProjectCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    leadId: ActorId.optional(),
    teamId: TeamId.optional(),
    startDate: z.iso.date().optional(),
    targetDate: z.iso.date().optional(),
    initiativeIds: z.array(InitiativeId).optional(),
  })
  .meta({ id: 'ProjectCreate', description: 'Create a project within an organization.' });
/** Validated project-create body. */
export type ProjectCreate = z.infer<typeof ProjectCreate>;

/** Full project representation returned by reads. */
export const ProjectOut = z
  .object({
    id: ProjectId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    health: Health.nullable().optional(),
    leadId: ActorId.nullable().optional(),
    teamId: TeamId.nullable().optional(),
    programId: ProgramId.nullable().optional(),
    startDate: z.string().nullable().optional(),
    targetDate: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'ProjectOut', description: 'A project.' });
/** Project representation value. */
export type ProjectOut = z.infer<typeof ProjectOut>;
