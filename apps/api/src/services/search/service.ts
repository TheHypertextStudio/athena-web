/**
 * Search service using PostgreSQL full-text search.
 *
 * @packageDocumentation
 */

import { db } from '../../db/index.js';
import { tasks, projects, events, initiatives } from '../../db/schema/index.js';
import { eq, or, and, ilike, isNull, sql, desc } from 'drizzle-orm';
import { getTaskStatusCategoryFromValue } from '../tasks/schemas.js';
import type {
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchSuggestion,
  IndexStats,
} from './types.js';

/**
 * Search service for full-text search across entities.
 */
export class SearchService {
  /**
   * Search across all entity types.
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const types = options.types ?? ['task', 'project', 'event', 'initiative'];

    const results: SearchResult[] = [];
    let total = 0;

    // Search each entity type
    const searchPromises: Promise<void>[] = [];

    if (types.includes('task')) {
      searchPromises.push(
        this.searchTasks(options).then((r) => {
          results.push(...r.results);
          total += r.total;
        }),
      );
    }

    if (types.includes('project')) {
      searchPromises.push(
        this.searchProjects(options).then((r) => {
          results.push(...r.results);
          total += r.total;
        }),
      );
    }

    if (types.includes('event')) {
      searchPromises.push(
        this.searchEvents(options).then((r) => {
          results.push(...r.results);
          total += r.total;
        }),
      );
    }

    if (types.includes('initiative')) {
      searchPromises.push(
        this.searchInitiatives(options).then((r) => {
          results.push(...r.results);
          total += r.total;
        }),
      );
    }

    await Promise.all(searchPromises);

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      results: paginatedResults,
      total,
      took: Date.now() - startTime,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Search tasks.
   */
  async searchTasks(options: SearchOptions): Promise<{ results: SearchResult[]; total: number }> {
    const { query, userId, projectId, status, includeArchived } = options;
    const searchPattern = `%${query}%`;

    // Build where conditions
    const conditions = [
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      or(ilike(tasks.title, searchPattern), ilike(tasks.description, searchPattern)),
    ];

    if (!includeArchived) {
      conditions.push(isNull(tasks.deletedAt));
    }

    if (projectId) {
      conditions.push(eq(tasks.projectId, projectId));
    }

    if (status?.length) {
      const categories = status
        .map((value) => getTaskStatusCategoryFromValue(value))
        .filter((value): value is NonNullable<typeof value> => value !== null);
      if (categories.length) {
        conditions.push(or(...categories.map((category) => eq(tasks.statusCategory, category))));
      }
    }

    const results = await db.query.tasks.findMany({
      where: and(...conditions),
      limit: 50,
      orderBy: [desc(tasks.updatedAt)],
    });

    return {
      results: results.map((task) => ({
        type: 'task' as const,
        id: task.id,
        score: this.calculateScore(query, task.title, task.description ?? ''),
        matchedField: task.title.toLowerCase().includes(query.toLowerCase())
          ? 'title'
          : 'description',
        highlight: this.highlight(query, task.title),
        data: task,
      })),
      total: results.length,
    };
  }

  /**
   * Search projects.
   */
  async searchProjects(
    options: SearchOptions,
  ): Promise<{ results: SearchResult[]; total: number }> {
    const { query, userId, includeArchived } = options;
    const searchPattern = `%${query}%`;

    const conditions = [
      eq(projects.ownerId, userId),
      or(ilike(projects.name, searchPattern), ilike(projects.description, searchPattern)),
    ];

    if (!includeArchived) {
      conditions.push(isNull(projects.deletedAt));
    }

    const results = await db.query.projects.findMany({
      where: and(...conditions),
      limit: 50,
      orderBy: [desc(projects.updatedAt)],
    });

    return {
      results: results.map((project) => ({
        type: 'project' as const,
        id: project.id,
        score: this.calculateScore(query, project.name, project.description ?? ''),
        matchedField: project.name.toLowerCase().includes(query.toLowerCase())
          ? 'name'
          : 'description',
        highlight: this.highlight(query, project.name),
        data: project,
      })),
      total: results.length,
    };
  }

  /**
   * Search events.
   */
  async searchEvents(options: SearchOptions): Promise<{ results: SearchResult[]; total: number }> {
    const { query, userId, dateFrom, dateTo } = options;
    const searchPattern = `%${query}%`;

    const conditions = [
      eq(events.creatorId, userId),
      or(ilike(events.title, searchPattern), ilike(events.description, searchPattern)),
    ];

    // Note: events table doesn't have deletedAt field

    if (dateFrom) {
      conditions.push(sql`${events.startTime} >= ${dateFrom}`);
    }

    if (dateTo) {
      conditions.push(sql`${events.startTime} <= ${dateTo}`);
    }

    const results = await db.query.events.findMany({
      where: and(...conditions),
      limit: 50,
      orderBy: [desc(events.startTime)],
    });

    return {
      results: results.map((event) => ({
        type: 'event' as const,
        id: event.id,
        score: this.calculateScore(query, event.title, event.description ?? ''),
        matchedField: event.title.toLowerCase().includes(query.toLowerCase())
          ? 'title'
          : 'description',
        highlight: this.highlight(query, event.title),
        data: event,
      })),
      total: results.length,
    };
  }

  /**
   * Search initiatives.
   */
  async searchInitiatives(
    options: SearchOptions,
  ): Promise<{ results: SearchResult[]; total: number }> {
    const { query, userId, includeArchived } = options;
    const searchPattern = `%${query}%`;

    const conditions = [
      eq(initiatives.ownerId, userId),
      or(ilike(initiatives.name, searchPattern), ilike(initiatives.description, searchPattern)),
    ];

    if (!includeArchived) {
      conditions.push(isNull(initiatives.deletedAt));
    }

    const results = await db.query.initiatives.findMany({
      where: and(...conditions),
      limit: 50,
      orderBy: [desc(initiatives.updatedAt)],
    });

    return {
      results: results.map((initiative) => ({
        type: 'initiative' as const,
        id: initiative.id,
        score: this.calculateScore(query, initiative.name, initiative.description ?? ''),
        matchedField: initiative.name.toLowerCase().includes(query.toLowerCase())
          ? 'name'
          : 'description',
        highlight: this.highlight(query, initiative.name),
        data: initiative,
      })),
      total: results.length,
    };
  }

  /**
   * Get search suggestions for autocomplete.
   */
  async getSuggestions(query: string, userId: string, limit = 10): Promise<SearchSuggestion[]> {
    const searchPattern = `${query}%`;
    const suggestions: SearchSuggestion[] = [];

    // Get task suggestions
    const taskSuggestions = await db.query.tasks.findMany({
      where: and(
        or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
        ilike(tasks.title, searchPattern),
        isNull(tasks.deletedAt),
      ),
      limit: limit,
      columns: { id: true, title: true },
    });

    suggestions.push(
      ...taskSuggestions.map((t) => ({
        text: t.title,
        type: 'task' as const,
        id: t.id,
      })),
    );

    // Get project suggestions
    const projectSuggestions = await db.query.projects.findMany({
      where: and(
        eq(projects.ownerId, userId),
        ilike(projects.name, searchPattern),
        isNull(projects.deletedAt),
      ),
      limit: limit,
      columns: { id: true, name: true },
    });

    suggestions.push(
      ...projectSuggestions.map((p) => ({
        text: p.name,
        type: 'project' as const,
        id: p.id,
      })),
    );

    // Sort by relevance (starts with query first)
    suggestions.sort((a, b) => {
      const aStarts = a.text.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
      const bStarts = b.text.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
      return aStarts - bStarts;
    });

    return suggestions.slice(0, limit);
  }

  /**
   * Get index statistics.
   */
  async getStats(userId: string): Promise<IndexStats> {
    const [taskCount, projectCount, eventCount, initiativeCount] = await Promise.all([
      db.query.tasks.findMany({
        where: and(
          or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
          isNull(tasks.deletedAt),
        ),
        columns: { id: true },
      }),
      db.query.projects.findMany({
        where: and(eq(projects.ownerId, userId), isNull(projects.deletedAt)),
        columns: { id: true },
      }),
      db.query.events.findMany({
        where: eq(events.creatorId, userId),
        columns: { id: true },
      }),
      db.query.initiatives.findMany({
        where: and(eq(initiatives.ownerId, userId), isNull(initiatives.deletedAt)),
        columns: { id: true },
      }),
    ]);

    return {
      totalDocuments:
        taskCount.length + projectCount.length + eventCount.length + initiativeCount.length,
      documentsByType: {
        task: taskCount.length,
        project: projectCount.length,
        event: eventCount.length,
        initiative: initiativeCount.length,
        moment: 0,
        activity: 0,
      },
      lastIndexedAt: new Date(),
    };
  }

  /**
   * Calculate relevance score.
   */
  private calculateScore(query: string, title: string, description: string): number {
    const queryLower = query.toLowerCase();
    const titleLower = title.toLowerCase();
    const descLower = description.toLowerCase();

    let score = 0;

    // Exact title match
    if (titleLower === queryLower) {
      score = 1.0;
    }
    // Title starts with query
    else if (titleLower.startsWith(queryLower)) {
      score = 0.9;
    }
    // Title contains query
    else if (titleLower.includes(queryLower)) {
      score = 0.7;
    }
    // Description contains query
    else if (descLower.includes(queryLower)) {
      score = 0.5;
    }
    // Partial word match
    else {
      const words = queryLower.split(/\s+/);
      const matchedWords = words.filter(
        (w) => titleLower.includes(w) || descLower.includes(w),
      ).length;
      score = (matchedWords / words.length) * 0.4;
    }

    return Math.round(score * 100) / 100;
  }

  /**
   * Create highlighted snippet.
   */
  private highlight(query: string, text: string): string {
    const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  /**
   * Escape regex special characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Singleton instance
let searchServiceInstance: SearchService | null = null;

/**
 * Get the shared search service instance.
 */
export function getSearchService(): SearchService {
  searchServiceInstance ??= new SearchService();
  return searchServiceInstance;
}
