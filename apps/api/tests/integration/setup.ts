/**
 * Integration test setup for API testing.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';

/**
 * Mock user ID for authenticated requests.
 */
export const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_USER_ID_2 = '00000000-0000-4000-8000-000000000002';

/**
 * Mock session for authenticated requests.
 */
export const mockSession = {
  user: {
    id: TEST_USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: '00000000-0000-4000-8000-000000000003',
    expiresAt: new Date(Date.now() + 86400000),
  },
};

/**
 * Mock auth middleware that sets test user context.
 */
export async function mockAuthMiddleware(c: Context, next: Next): Promise<void> {
  c.set('userId', TEST_USER_ID);
  c.set('session', mockSession);
  await next();
}

/**
 * Create a JSON request for testing.
 */
export function createRequest(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return new Request(`http://localhost${path}`, options);
}

/**
 * Parse a JSON response.
 */
export async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * Generate a unique ID for test entities.
 */
export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Sample test data factories.
 */
export const factories = {
  initiative: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('init'),
    name: 'Test Initiative',
    description: 'A test initiative',
    status: 'draft',
    ownerId: TEST_USER_ID,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  project: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('proj'),
    name: 'Test Project',
    description: 'A test project',
    status: 'planning',
    deadline: null,
    initiativeId: null,
    ownerId: TEST_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  task: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('task'),
    title: 'Test Task',
    description: 'A test task',
    status: 'pending',
    priority: 'medium',
    deadline: null,
    estimatedMinutes: null,
    projectId: null,
    assigneeId: null,
    creatorId: TEST_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  event: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('event'),
    title: 'Test Event',
    description: 'A test event',
    startTime: new Date(Date.now() + 86400000),
    endTime: new Date(Date.now() + 90000000),
    isAllDay: false,
    location: null,
    ownerId: TEST_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  moment: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('moment'),
    title: 'Test Moment',
    description: 'A test moment',
    occurredAt: new Date(),
    mood: null,
    ownerId: TEST_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  activityStream: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('stream'),
    name: 'Test Stream',
    description: 'A test activity stream',
    color: '#3b82f6',
    ownerId: TEST_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  activity: (streamId: string, overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('activity'),
    streamId,
    startTime: new Date(),
    endTime: new Date(Date.now() + 3600000),
    notes: 'Test activity notes',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  tag: (overrides: Record<string, unknown> = {}) => ({
    id: generateTestId('tag'),
    name: 'test-tag',
    color: '#ef4444',
    ownerId: TEST_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),
};
