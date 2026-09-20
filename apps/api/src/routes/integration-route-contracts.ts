/** Small request contracts shared by integration routes. */
import { z } from 'zod';

/** Import behavior selected for a provider migration. */
export const ImportBody = z.object({
  assignToImporter: z.boolean().optional().default(false),
});

/** Path parameter for one integration. */
export const integrationIdParam = z.object({ id: z.string() });
