/**
 * Search OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const SearchEntityTypeSchema = z
  .enum(['task', 'project', 'event', 'initiative', 'tag'])
  .openapi({
    description: 'Searchable entity type',
    example: 'task',
  });

// =============================================================================
// Core Search Schemas
// =============================================================================

export const SearchResultItemSchema = z
  .object({
    id: z.string().openapi({ description: 'Entity ID' }),
    type: SearchEntityTypeSchema,
    title: z.string().openapi({ description: 'Entity title/name' }),
    description: z.string().nullable().openapi({ description: 'Entity description' }),
    score: z.number().openapi({ description: 'Relevance score' }),
    highlight: z.string().nullable().openapi({ description: 'Highlighted match' }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'Additional metadata' }),
  })
  .openapi('SearchResultItem');

export const SearchResultsSchema = z
  .object({
    results: z.array(SearchResultItemSchema).openapi({ description: 'Search results' }),
    total: z.number().int().openapi({ description: 'Total matching results' }),
    query: z.string().openapi({ description: 'Search query' }),
    took: z.number().openapi({ description: 'Search time in ms' }),
  })
  .openapi('SearchResults');

export const SearchSuggestionSchema = z
  .object({
    text: z.string().openapi({ description: 'Suggestion text' }),
    type: SearchEntityTypeSchema,
    id: z.string().optional().openapi({ description: 'Entity ID if specific' }),
  })
  .openapi('SearchSuggestion');

export const SearchStatsSchema = z
  .object({
    totalIndexed: z.number().int().openapi({ description: 'Total indexed documents' }),
    byType: z.record(z.string(), z.number().int()).openapi({ description: 'Count by entity type' }),
    lastUpdated: z.string().openapi({ description: 'Last index update' }),
  })
  .openapi('SearchStats');

// =============================================================================
// Query Parameters
// =============================================================================

export const SearchQuerySchema = z
  .object({
    q: z
      .string()
      .min(1)
      .max(200)
      .openapi({
        description: 'Search query',
        param: { name: 'q', in: 'query' },
      }),
    types: z
      .string()
      .optional()
      .openapi({
        description: 'Comma-separated entity types to search',
        param: { name: 'types', in: 'query' },
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description: 'Maximum results',
        param: { name: 'limit', in: 'query' },
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({
        description: 'Results offset',
        param: { name: 'offset', in: 'query' },
      }),
    projectId: z
      .uuid()
      .optional()
      .openapi({
        description: 'Filter by project',
        param: { name: 'projectId', in: 'query' },
      }),
    tags: z
      .string()
      .optional()
      .openapi({
        description: 'Comma-separated tag names',
        param: { name: 'tags', in: 'query' },
      }),
    status: z
      .string()
      .optional()
      .openapi({
        description: 'Comma-separated statuses',
        param: { name: 'status', in: 'query' },
      }),
    dateFrom: z.iso
      .datetime()
      .optional()
      .openapi({
        description: 'Filter from date',
        param: { name: 'dateFrom', in: 'query' },
      }),
    dateTo: z.iso
      .datetime()
      .optional()
      .openapi({
        description: 'Filter to date',
        param: { name: 'dateTo', in: 'query' },
      }),
    includeArchived: z.coerce
      .boolean()
      .optional()
      .openapi({
        description: 'Include archived items',
        param: { name: 'includeArchived', in: 'query' },
      }),
  })
  .openapi('SearchQuery');

export const SuggestionsQuerySchema = z
  .object({
    q: z
      .string()
      .min(1)
      .max(100)
      .openapi({
        description: 'Query for suggestions',
        param: { name: 'q', in: 'query' },
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .openapi({
        description: 'Maximum suggestions',
        param: { name: 'limit', in: 'query' },
      }),
  })
  .openapi('SuggestionsQuery');

// =============================================================================
// Response Schemas
// =============================================================================

export const SearchResponseSchema = successResponseSchema(
  SearchResultsSchema,
  'Search results',
).openapi('SearchResponse');

export const SuggestionsResponseSchema = successResponseSchema(
  z.array(SearchSuggestionSchema),
  'Search suggestions',
).openapi('SuggestionsResponse');

export const SearchStatsResponseSchema = successResponseSchema(
  SearchStatsSchema,
  'Search statistics',
).openapi('SearchStatsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type SearchEntityType = z.infer<typeof SearchEntityTypeSchema>;
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;
export type SearchResults = z.infer<typeof SearchResultsSchema>;
export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>;
export type SearchStats = z.infer<typeof SearchStatsSchema>;
