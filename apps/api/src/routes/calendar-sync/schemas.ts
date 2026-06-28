/**
 * Calendar sync route schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

export const updateAccountSettingsRequestSchema = z.object({
  accountLabel: z.string().max(100).optional(),
  accountColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  isPrimary: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const reorderConnectionsRequestSchema = z.object({
  connectionIds: z.array(z.uuid()),
});
