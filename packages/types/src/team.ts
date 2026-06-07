/**
 * `@docket/types` — Team slice DTOs.
 */
import { z } from 'zod';

import { OrganizationId, TeamId } from './primitives';

/** Team representation returned by reads. */
export const TeamOut = z
  .object({
    id: TeamId,
    organizationId: OrganizationId,
    name: z.string(),
    key: z.string(),
    description: z.string().nullable().optional(),
    triageEnabled: z.boolean(),
  })
  .meta({ id: 'TeamOut', description: 'A team within an organization.' });
/** Team representation value. */
export type TeamOut = z.infer<typeof TeamOut>;
