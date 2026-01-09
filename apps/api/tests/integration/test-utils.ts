/**
 * Shared test utilities for integration tests.
 *
 * Provides a centralized, hoisted-friendly mock database factory and reset helper.
 * Use the global mock factory initialized in `tests/setup.ts` when the mock
 * must be available before module initialization.
 *
 * @packageDocumentation
 */

import { vi } from 'vitest';

const DEFAULT_USER = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  createdAt: new Date(),
};

const createMockQueryFn = <T>(returnValue: T) => {
  const fn = vi.fn<(..._args: unknown[]) => Promise<T>>();
  fn.mockResolvedValue(returnValue as Awaited<T>);
  return fn;
};

const createInsertChain = () => ({
  values: vi.fn(() => ({
    onConflictDoNothing: vi.fn(() => ({})),
    returning: vi.fn(() => Promise.resolve([{ id: 'new-id' }])),
  })),
});

const createUpdateChain = () => ({
  set: vi.fn(() => ({
    where: vi.fn(() => Promise.resolve(undefined)),
  })),
});

const createDeleteChain = () => ({
  where: vi.fn(() => Promise.resolve(undefined)),
});

const createSelectChain = () => ({
  from: vi.fn(() => ({
    innerJoin: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([])),
      })),
    })),
    where: vi.fn(() => ({
      limit: vi.fn(() => Promise.resolve([])),
    })),
  })),
});

/**
 * Creates mock setup for use in non-hoisted contexts.
 */
export function createMockDb() {
  return {
    query: {
      initiatives: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      projects: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      tasks: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      events: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      eventParticipants: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      moments: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      activityStreams: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      activities: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      tags: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      timeEntries: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      timeBlocks: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      workspaces: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      userSettings: {
        findFirst: createMockQueryFn(null as unknown),
      },
      aiPreferences: {
        findFirst: createMockQueryFn(null as unknown),
      },
      notificationPreferences: {
        findFirst: createMockQueryFn(null as unknown),
      },
      notifications: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      scheduledNotifications: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      subscriptions: {
        findFirst: createMockQueryFn(null as unknown),
      },
      linkedIntegrations: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      conversations: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      attachments: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      webhookEndpoints: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      auditLogs: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      taskDependencies: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      projectDependencies: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      agendaTaskOrder: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      taskTags: {
        findMany: createMockQueryFn([] as unknown[]),
        findFirst: createMockQueryFn(null as unknown),
      },
      onboardingProgress: {
        findFirst: createMockQueryFn(null as unknown),
      },
      users: {
        findFirst: createMockQueryFn(DEFAULT_USER as unknown),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
    delete: vi.fn(() => createDeleteChain()),
    select: vi.fn(() => createSelectChain()),
  };
}

/**
 * Type for the mock database.
 */
export type MockDb = ReturnType<typeof createMockDb>;

/**
 * Resets all mock values to defaults.
 */
export function resetMockDb(mockDb: MockDb) {
  Object.values(mockDb.query).forEach((entity) => {
    if ('findMany' in entity) {
      entity.findMany.mockReset();
      entity.findMany.mockResolvedValue([]);
    }
    if ('findFirst' in entity) {
      entity.findFirst.mockReset();
      entity.findFirst.mockResolvedValue(null);
    }
  });
  mockDb.query.users.findFirst.mockResolvedValue(DEFAULT_USER);

  mockDb.select.mockReset();
  mockDb.select.mockImplementation(() => createSelectChain());
  mockDb.insert.mockReset();
  mockDb.insert.mockImplementation(() => createInsertChain());
  mockDb.update.mockReset();
  mockDb.update.mockImplementation(() => createUpdateChain());
  mockDb.delete.mockReset();
  mockDb.delete.mockImplementation(() => createDeleteChain());
}
