/**
 * Search routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSearchService } from '../services/search/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import type { SearchableEntity } from '../services/search/types.js';

const app = new Hono();

app.use('*', requireAuth);

const PAGINATION_LIMIT_MIN = 1;
const PAGINATION_LIMIT_MAX = 100;
const PAGINATION_OFFSET_MIN = 0;
const SEARCH_QUERY_MIN_LENGTH = 1;
const SEARCH_QUERY_MAX_LENGTH = 200;
const SEARCH_SUGGESTIONS_QUERY_MAX_LENGTH = 100;
const SEARCH_SUGGESTIONS_LIMIT_MAX = 20;

/**
 * GET /search
 * Search across all entity types.
 */
app.get(
  '/',
  zValidator(
    'query',
    z.object({
      q: z.string().min(SEARCH_QUERY_MIN_LENGTH).max(SEARCH_QUERY_MAX_LENGTH),
      types: z.string().optional(), // comma-separated: task,project,event
      limit: z.coerce.number().min(PAGINATION_LIMIT_MIN).max(PAGINATION_LIMIT_MAX).optional(),
      offset: z.coerce.number().min(PAGINATION_OFFSET_MIN).optional(),
      projectId: z.uuid().optional(),
      tags: z.string().optional(), // comma-separated
      status: z.string().optional(), // comma-separated
      dateFrom: z.iso.datetime().optional(),
      dateTo: z.iso.datetime().optional(),
      includeArchived: z.coerce.boolean().optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const params = c.req.valid('query');

    const service = getSearchService();
    const response = await service.search({
      query: params.q,
      userId,
      types: params.types?.split(',') as SearchableEntity[] | undefined,
      limit: params.limit,
      offset: params.offset,
      projectId: params.projectId,
      tags: params.tags?.split(','),
      status: params.status?.split(','),
      dateFrom: params.dateFrom ? new Date(params.dateFrom) : undefined,
      dateTo: params.dateTo ? new Date(params.dateTo) : undefined,
      includeArchived: params.includeArchived,
    });

    return c.json({
      success: true,
      data: response,
    });
  },
);

/**
 * GET /search/suggestions
 * Get autocomplete suggestions.
 */
app.get(
  '/suggestions',
  zValidator(
    'query',
    z.object({
      q: z.string().min(SEARCH_QUERY_MIN_LENGTH).max(SEARCH_SUGGESTIONS_QUERY_MAX_LENGTH),
      limit: z.coerce
        .number()
        .min(PAGINATION_LIMIT_MIN)
        .max(SEARCH_SUGGESTIONS_LIMIT_MAX)
        .optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { q, limit } = c.req.valid('query');

    const service = getSearchService();
    const suggestions = await service.getSuggestions(q, userId, limit);

    return c.json({
      success: true,
      data: suggestions,
    });
  },
);

/**
 * GET /search/stats
 * Get search index statistics.
 */
app.get('/stats', async (c) => {
  const userId = getUserId(c);

  const service = getSearchService();
  const stats = await service.getStats(userId);

  return c.json({
    success: true,
    data: stats,
  });
});

export default app;
