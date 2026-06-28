/**
 * Project route schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

export const TaskDependencyGraphQuerySchema = z.object({
  includeCompleted: z.coerce
    .boolean()
    .optional()
    .openapi({
      description: 'Whether to include completed tasks',
      param: { name: 'includeCompleted', in: 'query' },
    }),
});

export const TaskDependencyGraphResponseSchema = z.object({
  data: z.object({
    tasks: z.array(z.unknown()),
    dependencies: z.array(
      z.object({
        taskId: z.string(),
        dependsOnTaskId: z.string(),
      }),
    ),
  }),
});
