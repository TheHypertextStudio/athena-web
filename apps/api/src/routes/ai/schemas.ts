/**
 * AI route schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

export const fieldCompletionRequestSchema = z.object({
  type: z.literal('field_suggestion'),
  context: z.object({
    objectType: z.enum(['initiative', 'task', 'project']),
    field: z.enum(['title', 'description']),
    values: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
  }),
});

export const fieldCompletionResponseSchema = z.object({
  completions: z.array(z.string()),
});
