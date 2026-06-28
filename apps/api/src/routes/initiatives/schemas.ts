/**
 * Initiative route schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import {
  CreateInitiativeRequestSchema,
  ListInitiativesQuerySchema,
  UpdateInitiativeRequestSchema,
} from '@athena/types/openapi/initiatives';
import { TimestampSchema } from '@athena/types/openapi/common';

export const InitiativeCategorySchema = z.enum([
  'planning',
  'active',
  'completed',
  'archived',
]);

export const ListInitiativesQueryWithStatusSchema = ListInitiativesQuerySchema.extend({
  category: InitiativeCategorySchema.optional().openapi({
    description: 'Filter by status category',
    param: { name: 'category', in: 'query' },
  }),
  statusId: z
    .uuid()
    .optional()
    .openapi({
      description: 'Filter by custom status ID',
      param: { name: 'statusId', in: 'query' },
    }),
});

export const CreateInitiativeRequestWithStatusSchema = CreateInitiativeRequestSchema.extend({
  statusId: z.uuid().optional().openapi({
    description: 'Custom status ID',
  }),
});

export const UpdateInitiativeRequestWithStatusSchema = UpdateInitiativeRequestSchema.extend({
  statusId: z.uuid().optional().openapi({
    description: 'Custom status ID',
  }),
});

export const InitiativeMetricsResponseSchema = z.object({
  data: z.object({
    taskCounts: z.object({
      total: z.number().int(),
      completed: z.number().int(),
      inProgress: z.number().int(),
      pending: z.number().int(),
    }),
    projectStats: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        totalTasks: z.number().int(),
        completedTasks: z.number().int(),
        progress: z.number().int(),
        health: z.enum(['on_track', 'at_risk', 'blocked']),
      }),
    ),
    timeStats: z.object({
      estimatedMinutes: z.number().int(),
      loggedMinutes: z.number().int(),
      remainingMinutes: z.number().int(),
    }),
    velocity: z.object({
      current: z.number().int(),
      average: z.number(),
      trend: z.number(),
      weeklyCompletions: z.array(z.number().int()),
    }),
    projectedCompletion: TimestampSchema.nullable(),
  }),
});

export type InitiativeMetricsResponse = z.infer<typeof InitiativeMetricsResponseSchema>;
