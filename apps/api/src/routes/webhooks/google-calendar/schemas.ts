/**
 * Google Calendar webhook schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

export const GoogleCalendarHeadersSchema = z.object({
  'x-goog-channel-id': z.string(),
  'x-goog-channel-token': z.string().regex(/^[^:]+:[^:]+$/),
  'x-goog-resource-state': z.enum(['sync', 'exists', 'not_exists']).optional(),
  'x-goog-resource-id': z.string().optional(),
});

export type GoogleCalendarHeaders = z.infer<typeof GoogleCalendarHeadersSchema>;
