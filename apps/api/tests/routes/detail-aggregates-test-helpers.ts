import { vi } from 'vitest';
import type * as DbModule from '@docket/db';

/**
 * Mock database query tracking for aggregate request analysis.
 * Counts only queries after fixture setup.
 */
export function observeDatabaseQueries(db: typeof DbModule.db) {
  const client = Reflect.get(db, '$client') as {
    query: (...args: unknown[]) => Promise<unknown>;
  };
  const original = client.query.bind(client);
  const query = vi.fn(original);
  client.query = query;
  return {
    count: () => query.mock.calls.length,
    restore: () => {
      client.query = original;
    },
  };
}

/**
 * Mock numeric-as-string responses from postgres-js in aggregate queries.
 * Patches count(*) filter rows to return string values for numeric columns.
 */
export function mockPostgresNumericAsStringQuery(
  db: typeof DbModule.db,
  isAggregateQuery: (queryStr: string) => boolean,
) {
  const client = Reflect.get(db, '$client') as {
    query: (
      query: string,
      params?: unknown[],
      options?: unknown,
    ) => Promise<{ rows?: Record<string, unknown>[] }>;
  };
  const original = client.query.bind(client);
  const queryFn = async (...args: unknown[]) => {
    const result = await original(...(args as Parameters<typeof original>));
    if (typeof args[0] === 'string' && isAggregateQuery(args[0])) {
      for (const row of result.rows ?? []) {
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === 'number') row[key] = String(value);
        }
      }
    }
    return result;
  };
  client.query = queryFn;
  return {
    restore: () => {
      client.query = original;
    },
  };
}

/**
 * Mock client.query to return empty result set for all queries.
 */
export function mockEmptyDatabaseQueries(db: typeof DbModule.db) {
  const client = Reflect.get(db, '$client') as {
    query: (...args: unknown[]) => Promise<unknown>;
  };
  const original = client.query;
  client.query = vi.fn().mockResolvedValue({ rows: [] });
  return {
    restore: () => {
      client.query = original;
    },
  };
}

/**
 * Common capability expectations for different permission levels.
 */
export const capabilityMatrix = {
  view: { comment: false, contribute: false, assign: false, manage: false },
  comment: { comment: true, contribute: false, assign: false, manage: false },
  contribute: { comment: true, contribute: true, assign: false, manage: false },
  assign: { comment: true, contribute: true, assign: true, manage: false },
  manage: { comment: true, contribute: true, assign: true, manage: true },
} as const;

/**
 * Build a POST request body for creating an Initiative.
 */
export function buildInitiativeCreateRequest(
  overrides?: Partial<{ name: string; ownerId: string }>,
) {
  return {
    name: overrides?.name ?? 'Test Initiative',
    ...(overrides?.ownerId && { ownerId: overrides.ownerId }),
  };
}

/**
 * Build a POST request body for creating a Program.
 */
export function buildProgramCreateRequest(
  overrides?: Partial<{ name: string; ownerId: string }>,
) {
  return {
    name: overrides?.name ?? 'Test Program',
    ...(overrides?.ownerId && { ownerId: overrides.ownerId }),
  };
}

/**
 * Build a POST request body for creating a Project.
 */
export function buildProjectCreateRequest(
  overrides?: Partial<{ name: string; teamId: string; leadId: string }>,
) {
  return {
    name: overrides?.name ?? 'Test Project',
    ...(overrides?.teamId && { teamId: overrides.teamId }),
    ...(overrides?.leadId && { leadId: overrides.leadId }),
  };
}

/**
 * Build a POST request body for linking a work item.
 */
export function buildWorkLinkRequest(
  overrides: { projectId?: string; programId?: string },
) {
  if (overrides.projectId) return { projectId: overrides.projectId };
  if (overrides.programId) return { programId: overrides.programId };
  throw new Error('Either projectId or programId required');
}
