/**
 * Search service types.
 *
 * @packageDocumentation
 */

/**
 * Searchable entity types.
 */
export type SearchableEntity = 'task' | 'project' | 'event' | 'initiative' | 'moment' | 'activity';

/**
 * Search result item.
 */
export interface SearchResult<T = unknown> {
  /**
   * Entity type.
   */
  type: SearchableEntity;

  /**
   * Entity ID.
   */
  id: string;

  /**
   * Relevance score (0-1).
   */
  score: number;

  /**
   * Matched field.
   */
  matchedField: string;

  /**
   * Highlighted snippet.
   */
  highlight?: string;

  /**
   * Full entity data.
   */
  data: T;
}

/**
 * Search options.
 */
export interface SearchOptions {
  /**
   * Search query string.
   */
  query: string;

  /**
   * Entity types to search.
   */
  types?: SearchableEntity[];

  /**
   * User ID for scoping results.
   */
  userId: string;

  /**
   * Maximum results to return.
   */
  limit?: number;

  /**
   * Offset for pagination.
   */
  offset?: number;

  /**
   * Filter by project ID.
   */
  projectId?: string;

  /**
   * Filter by tags.
   */
  tags?: string[];

  /**
   * Filter by status.
   */
  status?: string[];

  /**
   * Filter by date range.
   */
  dateFrom?: Date;
  dateTo?: Date;

  /**
   * Include archived/deleted items.
   */
  includeArchived?: boolean;
}

/**
 * Search response.
 */
export interface SearchResponse {
  /**
   * Search results.
   */
  results: SearchResult[];

  /**
   * Total count of matching results.
   */
  total: number;

  /**
   * Query execution time in ms.
   */
  took: number;

  /**
   * Pagination info.
   */
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Suggestion for autocomplete.
 */
export interface SearchSuggestion {
  text: string;
  type: SearchableEntity;
  id: string;
}

/**
 * Index statistics.
 */
export interface IndexStats {
  totalDocuments: number;
  documentsByType: Record<SearchableEntity, number>;
  lastIndexedAt: Date;
}
