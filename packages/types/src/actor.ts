/**
 * `@docket/types` — Actor slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, RoleId } from './primitives';

/** Actor representation returned by reads (the org-scoped identity for any "who"). */
export const ActorOut = z
  .object({
    id: ActorId,
    organizationId: OrganizationId,
    kind: z.enum(['human', 'agent', 'team']),
    displayName: z.string(),
    avatar: z.string().nullable().optional(),
    status: z.enum(['active', 'suspended']),
    roleId: RoleId.nullable().optional(),
  })
  .meta({ id: 'ActorOut', description: 'An org-scoped actor.' });
/** Actor representation value. */
export type ActorOut = z.infer<typeof ActorOut>;
