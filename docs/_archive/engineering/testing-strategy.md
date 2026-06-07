# Testing Strategy

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Overview

This document defines the testing strategy for Project Athena, ensuring code quality, reliability, and maintainability.

## Testing Pyramid

```
                    ┌───────────────┐
                    │     E2E       │  ← Few, slow, high confidence
                    │   (Playwright)│
                    ├───────────────┤
                    │  Integration  │  ← Medium, focused
                    │   (Vitest)    │
                    ├───────────────┤
                    │     Unit      │  ← Many, fast, isolated
                    │   (Vitest)    │
                    └───────────────┘
```

## Coverage Requirements

| Package | Minimum Coverage | Target Coverage |
| ------- | ---------------- | --------------- |
| api     | 80%              | 90%             |
| web     | 80%              | 85%             |
| shared  | 90%              | 95%             |
| types   | N/A (type-only)  | N/A             |

### Coverage Enforcement

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
```

## Unit Testing

### What to Unit Test

- Pure functions
- Business logic
- Validation schemas
- Utility functions
- Component rendering (without API calls)

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { calculatePriority } from './priority';

describe('calculatePriority', () => {
  describe('when task has deadline', () => {
    it('returns high priority for overdue tasks', () => {
      const task = {
        deadline: new Date('2020-01-01'),
        importance: 'medium',
      };

      expect(calculatePriority(task)).toBe('high');
    });

    it('returns medium priority for tasks due this week', () => {
      // ...
    });
  });

  describe('when task has no deadline', () => {
    it('returns priority based on importance only', () => {
      // ...
    });
  });
});
```

### Best Practices

1. **One assertion per test** (when practical)
2. **Descriptive test names** - Use `describe` and `it` to form sentences
3. **AAA pattern** - Arrange, Act, Assert
4. **No shared mutable state** - Reset in `beforeEach`
5. **Test behavior, not implementation**

## Integration Testing

### What to Integration Test

- API endpoints (full request/response cycle)
- Database operations
- Authentication flows
- External service integrations (mocked)

### API Integration Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testClient } from 'hono/testing';
import { app } from '../src/app';
import { setupTestDb, teardownTestDb, createTestUser } from '@athena/test-utils';

describe('POST /api/tasks', () => {
  let db: TestDb;
  let authToken: string;

  beforeAll(async () => {
    db = await setupTestDb();
    const user = await createTestUser(db);
    authToken = await generateTestToken(user);
  });

  afterAll(async () => {
    await teardownTestDb(db);
  });

  it('creates a task with valid input', async () => {
    const client = testClient(app);

    const response = await client.api.tasks.$post({
      json: {
        title: 'Test Task',
        priority: 'high',
      },
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.data.attributes.title).toBe('Test Task');
    expect(data.data.attributes.priority).toBe('high');
  });

  it('returns 400 for invalid input', async () => {
    const client = testClient(app);

    const response = await client.api.tasks.$post({
      json: {
        // Missing required 'title' field
        priority: 'high',
      },
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const client = testClient(app);

    const response = await client.api.tasks.$post({
      json: {
        title: 'Test Task',
      },
    });

    expect(response.status).toBe(401);
  });
});
```

### Database Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, resetTestDb } from '@athena/test-utils';
import { TaskRepository } from '../src/repositories/task';

describe('TaskRepository', () => {
  let db: TestDb;
  let taskRepo: TaskRepository;

  beforeEach(async () => {
    db = await createTestDb();
    await resetTestDb(db);
    taskRepo = new TaskRepository(db);
  });

  it('creates and retrieves a task', async () => {
    const created = await taskRepo.create({
      title: 'Test Task',
      userId: 'user_123',
    });

    const retrieved = await taskRepo.findById(created.id);

    expect(retrieved).toMatchObject({
      title: 'Test Task',
      status: 'pending',
    });
  });
});
```

## E2E Testing

### What to E2E Test

- Critical user journeys
- Authentication flows
- Core workflows (create task, schedule event, etc.)
- Cross-browser compatibility

### E2E Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Task Creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loginAsTestUser(page);
  });

  test('user can create a task from the agenda', async ({ page }) => {
    // Navigate to agenda
    await page.click('[data-testid="nav-agenda"]');

    // Open task creation
    await page.click('[data-testid="create-task-button"]');

    // Fill form
    await page.fill('[data-testid="task-title-input"]', 'My New Task');
    await page.selectOption('[data-testid="priority-select"]', 'high');

    // Submit
    await page.click('[data-testid="submit-task-button"]');

    // Verify task appears in agenda
    await expect(page.locator('[data-testid="task-item"]')).toContainText('My New Task');
  });
});
```

### Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

## Mocking

### External Services

```typescript
// mocks/stripe.ts
import { vi } from 'vitest';

export const mockStripe = {
  customers: {
    create: vi.fn().mockResolvedValue({
      id: 'cus_test123',
      email: 'test@example.com',
    }),
    retrieve: vi.fn().mockResolvedValue({
      id: 'cus_test123',
      subscriptions: { data: [] },
    }),
  },
  subscriptions: {
    create: vi.fn().mockResolvedValue({
      id: 'sub_test123',
      status: 'active',
    }),
  },
};
```

### API Responses

```typescript
// mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/tasks', () => {
    return HttpResponse.json({
      data: [{ id: '1', type: 'task', attributes: { title: 'Mock Task' } }],
    });
  }),
];
```

## Test Utilities

### Fixtures

```typescript
// test-utils/fixtures/tasks.ts
import { faker } from '@faker-js/faker';

export function createTaskFixture(overrides = {}) {
  return {
    id: faker.string.uuid(),
    title: faker.lorem.sentence(),
    status: 'pending',
    priority: 'medium',
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  };
}
```

### Test Helpers

```typescript
// test-utils/helpers/auth.ts
export async function loginAsTestUser(page: Page) {
  await page.goto('/auth/signin');
  await page.fill('[data-testid="email-input"]', 'test@example.com');
  await page.click('[data-testid="submit-button"]');
  // Handle test auth flow
}

export function generateTestToken(user: User) {
  return jwt.sign({ sub: user.id, scope: ['read', 'write'] }, process.env.JWT_SECRET!, {
    expiresIn: '1h',
  });
}
```

## CI Integration

### GitHub Actions Workflow

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-and-integration:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install

      - run: pnpm test:coverage
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/test

      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/coverage-final.json

  e2e:
    runs-on: ubuntu-latest
    needs: unit-and-integration

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install

      - run: npx playwright install --with-deps

      - run: pnpm test:e2e

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## Test Commands

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

_See also: [Architecture](./architecture.md), [Code Style](../contributing/code-style.md)_
