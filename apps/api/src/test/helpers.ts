/**
 * Test helpers for API testing.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';

/**
 * Mock user ID for authenticated requests.
 */
export const mockUserId = '00000000-0000-0000-0000-000000000001';

/**
 * Mock session for authenticated requests.
 */
export const mockSession = {
  user: {
    id: mockUserId,
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: '00000000-0000-0000-0000-000000000002',
    expiresAt: new Date(Date.now() + 86400000),
  },
};

/**
 * Create a mock auth middleware that sets test user context.
 */
export function mockRequireAuth(c: Context, next: Next): Promise<void> {
  c.set('userId', mockUserId);
  c.set('session', mockSession);
  return next();
}

/**
 * Create a test request with JSON body.
 */
export function createJsonRequest(
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

  if (body) {
    options.body = JSON.stringify(body);
  }

  return new Request(`http://localhost${path}`, options);
}

/**
 * Parse JSON response.
 */
export async function parseResponse<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
