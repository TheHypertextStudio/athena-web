/**
 * Search routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  SearchQuerySchema,
  SuggestionsQuerySchema,
  SearchResponseSchema,
  SuggestionsResponseSchema,
  SearchStatsResponseSchema,
} from '@athena/types/openapi/search';
import { UnauthorizedErrorSchema } from '@athena/types/openapi/common';
import { getSearchService } from '../services/search/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import type { SearchableEntity } from '../services/search/types.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toSearchStats } from './search/serializers.js';

const app = createOpenAPIApp();

app.use('*', requireAuth);

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const search = createRoute({
  method: 'get',
  path: '/',
  tags: ['Search'],
  summary: 'Search',
  description: 'Search across all entity types.',
  request: {
    query: SearchQuerySchema,
  },
  responses: {
    200: {
      description: 'Search results',
      content: {
        'application/json': {
          schema: SearchResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const suggestions = createRoute({
  method: 'get',
  path: '/suggestions',
  tags: ['Search'],
  summary: 'Get suggestions',
  description: 'Get autocomplete suggestions.',
  request: {
    query: SuggestionsQuerySchema,
  },
  responses: {
    200: {
      description: 'Suggestions retrieved',
      content: {
        'application/json': {
          schema: SuggestionsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const stats = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Search'],
  summary: 'Get search stats',
  description: 'Get search index statistics.',
  responses: {
    200: {
      description: 'Stats retrieved',
      content: {
        'application/json': {
          schema: SearchStatsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

/**
 * GET /search
 * Search across all entity types.
 */
app.openapi(search, async (c) => {
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
    dateFrom: params.dateFrom ?? undefined,
    dateTo: params.dateTo ?? undefined,
    includeArchived: params.includeArchived,
  });

  return c.json({ data: response }, 200);
});

/**
 * GET /search/suggestions
 * Get autocomplete suggestions.
 */
app.openapi(suggestions, async (c) => {
  const userId = getUserId(c);
  const { q, limit } = c.req.valid('query');

  const service = getSearchService();
  const suggestions = await service.getSuggestions(q, userId, limit);

  return c.json({ data: suggestions }, 200);
});

/**
 * GET /search/stats
 * Get search index statistics.
 */
app.openapi(stats, async (c) => {
  const userId = getUserId(c);

  const service = getSearchService();
  const stats = await service.getStats(userId);

  return c.json({ data: toSearchStats(stats) }, 200);
});

export default app;
