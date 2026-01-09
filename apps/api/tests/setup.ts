/**
 * Vitest test setup file.
 *
 * Sets up mock environment variables and global mocks for all tests.
 *
 * @packageDocumentation
 */

import { vi } from 'vitest';
import { createMockDb } from './integration/test-utils.js';

// Set up mock environment variables before any imports
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-that-is-at-least-32-chars';
process.env['BETTER_AUTH_URL'] = 'http://localhost:4000';
process.env['FRONTEND_URL'] = 'http://localhost:3000';
process.env['PORT'] = '4000';
process.env.NODE_ENV = 'test';

const globalWithMocks = globalThis as typeof globalThis & {
  __athenaMockDbFactory?: () => ReturnType<typeof createMockDb>;
};

globalWithMocks.__athenaMockDbFactory = createMockDb;

// Mock the logger to prevent console output during tests
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    })),
  },
}));
