/**
 * Outlook Calendar webhook schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

export const OutlookValidationQuerySchema = z.object({
  validationToken: z.string().optional(),
});

export const OutlookNotificationSchema = z
  .object({
    subscriptionId: z.string().optional(),
    subscriptionExpirationDateTime: z.string().optional(),
    changeType: z.enum(['created', 'updated', 'deleted']),
    resource: z.string(),
    resourceData: z
      .object({
        '@odata.type': z.string().optional(),
        '@odata.id': z.string().optional(),
        '@odata.etag': z.string().optional(),
        id: z.string().optional(),
      })
      .optional(),
    clientState: z.string().optional(),
    tenantId: z.string().optional(),
  })
  .loose();

export const OutlookNotificationPayloadSchema = z.object({
  value: z.array(OutlookNotificationSchema),
});

export type OutlookNotificationPayload = z.infer<typeof OutlookNotificationPayloadSchema>;
