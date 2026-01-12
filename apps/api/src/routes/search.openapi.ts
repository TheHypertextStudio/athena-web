/**
 * Search OpenAPI route definitions.
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

// =============================================================================
// Search
// =============================================================================

export const search = createRoute({
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

// =============================================================================
// Suggestions
// =============================================================================

export const suggestions = createRoute({
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

// =============================================================================
// Stats
// =============================================================================

export const stats = createRoute({
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
