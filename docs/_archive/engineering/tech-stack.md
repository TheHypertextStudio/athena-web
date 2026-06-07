# Technology Stack

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Overview

This document defines the technology choices for Project Athena. All decisions were made based on the requirements outlined in the product specifications and optimized for developer experience, performance, and maintainability.

## Core Technologies

### Runtime & Language

| Technology | Version | Purpose               |
| ---------- | ------- | --------------------- |
| Node.js    | 20 LTS  | Server runtime        |
| TypeScript | 5.x     | Type-safe development |
| pnpm       | 9.x     | Package management    |

### Monorepo Tooling

| Technology      | Purpose                      |
| --------------- | ---------------------------- |
| Turborepo       | Build orchestration, caching |
| pnpm workspaces | Package management           |

**Rationale**: Turborepo provides fast builds with remote caching and minimal configuration. pnpm offers disk-efficient dependency management with strict resolution.

## Backend Stack

### API Framework

| Technology        | Purpose             |
| ----------------- | ------------------- |
| Hono              | Web framework       |
| @hono/zod-openapi | OpenAPI integration |
| Zod               | Runtime validation  |

**Rationale**: Hono is lightweight, fast, and has excellent TypeScript support. Native OpenAPI integration enables automatic API documentation.

```typescript
// Example: Type-safe route definition
import { createRoute, z } from '@hono/zod-openapi';

const getTaskRoute = createRoute({
  method: 'get',
  path: '/tasks/{id}',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: TaskSchema,
        },
      },
      description: 'Task retrieved successfully',
    },
  },
});
```

### Database

| Technology  | Purpose           |
| ----------- | ----------------- |
| PostgreSQL  | Primary database  |
| Drizzle ORM | Type-safe queries |
| Drizzle Kit | Migrations        |

**Rationale**: Drizzle provides SQL-like syntax with full type safety. Lightweight runtime with no code generation step required.

```typescript
// Example: Drizzle schema
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

### Authentication

| Technology             | Purpose           |
| ---------------------- | ----------------- |
| better-auth            | Auth framework    |
| @simplewebauthn/server | WebAuthn/Passkeys |

**Rationale**: better-auth is a modern, TypeScript-first auth library with built-in OAuth, sessions, and extensibility.

### Logging & Monitoring

| Technology    | Purpose             |
| ------------- | ------------------- |
| Pino          | Structured logging  |
| Sentry        | Error tracking      |
| OpenTelemetry | Distributed tracing |

**Rationale**: Pino is the fastest JSON logger for Node.js, ideal for Cloud Run. Sentry provides comprehensive error monitoring.

```typescript
// Example: Pino configuration
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: ['req.headers.authorization', 'password'],
});
```

### Payments

| Technology  | Purpose            |
| ----------- | ------------------ |
| Stripe      | Payment processing |
| stripe-node | Stripe SDK         |

**Rationale**: Industry-standard payment processing with excellent developer experience and documentation.

## Frontend Stack

### Framework

| Technology | Purpose              |
| ---------- | -------------------- |
| Next.js 15 | React meta-framework |
| React 19   | UI library           |
| App Router | File-based routing   |

**Rationale**: Next.js provides SSR, Server Components, and excellent developer experience. App Router is the modern standard.

### UI Components

| Technology   | Purpose               |
| ------------ | --------------------- |
| shadcn/ui    | Component library     |
| Radix UI     | Headless primitives   |
| Tailwind CSS | Utility-first styling |

**Rationale**: shadcn/ui provides beautiful, accessible components that are fully customizable since they're copied into the project.

```typescript
// Example: Using shadcn/ui Button
import { Button } from '@/components/ui/button';

export function SubmitButton() {
  return (
    <Button variant="default" size="lg">
      Create Task
    </Button>
  );
}
```

### State Management

| Technology              | Purpose                            |
| ----------------------- | ---------------------------------- |
| React Server Components | Server state                       |
| Server Actions          | Mutations                          |
| TanStack Query          | Client data fetching (when needed) |

**Rationale**: SSR-first approach using React Server Components. Client-side data fetching only when necessary for real-time updates.

```typescript
// Example: Server Action
'use server';

import { revalidatePath } from 'next/cache';
import { createTask } from '@/lib/api';

export async function createTaskAction(formData: FormData) {
  const title = formData.get('title') as string;

  await createTask({ title });

  revalidatePath('/tasks');
}
```

## Testing Stack

### Test Framework

| Technology             | Purpose           |
| ---------------------- | ----------------- |
| Vitest                 | Test runner       |
| @testing-library/react | Component testing |
| Playwright             | E2E testing       |

**Rationale**: Vitest is fast, has native ESM support, and Jest-compatible API. Testing Library promotes accessible testing practices.

### Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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

## CI/CD Stack

### Continuous Integration

| Technology       | Purpose              |
| ---------------- | -------------------- |
| GitHub Actions   | CI/CD pipelines      |
| Husky            | Git hooks            |
| lint-staged      | Pre-commit linting   |
| semantic-release | Automated versioning |

### Pre-commit Hooks

```bash
# .husky/pre-commit
pnpm lint-staged
```

```json
// lint-staged.config.js
export default {
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md}': ['prettier --write'],
};
```

### Deployment

| Technology       | Purpose            |
| ---------------- | ------------------ |
| Google Cloud Run | Container hosting  |
| Cloud SQL        | Managed PostgreSQL |
| Cloud Build      | CI/CD integration  |

## Development Tools

### Code Quality

| Technology | Purpose       |
| ---------- | ------------- |
| ESLint     | Linting       |
| Prettier   | Formatting    |
| TypeScript | Type checking |

### Documentation

| Technology | Purpose               |
| ---------- | --------------------- |
| Scalar     | API documentation     |
| TSDoc      | Code documentation    |
| Markdown   | General documentation |

### Environment Management

| Technology | Purpose                |
| ---------- | ---------------------- |
| dotenv     | Environment variables  |
| Zod        | Environment validation |

```typescript
// env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DATABASE_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  SENTRY_DSN: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
```

## Package Structure

```
packages/
├── api/                 # Hono backend
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
│
├── web/                 # Next.js frontend
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
│
├── shared/              # Shared utilities
│   ├── src/
│   │   ├── validation/  # Zod schemas
│   │   └── utils/       # Utility functions
│   └── package.json
│
├── types/               # Shared types
│   ├── src/
│   │   ├── api/         # API types
│   │   └── domain/      # Domain types
│   └── package.json
│
└── test-utils/          # Test utilities
    ├── src/
    │   ├── fixtures/
    │   └── mocks/
    └── package.json
```

## Version Compatibility

| Package    | Minimum Version | Notes             |
| ---------- | --------------- | ----------------- |
| Node.js    | 20.0.0          | LTS required      |
| pnpm       | 9.0.0           | Workspace support |
| TypeScript | 5.0.0           | Satisfies keyword |
| Next.js    | 15.0.0          | App Router stable |
| React      | 19.0.0          | Server Components |
| Hono       | 4.0.0           | Stable API        |
| Drizzle    | 0.30.0          | Latest stable     |

---

_See also: [Architecture](./architecture.md), [API Design](./api-design.md)_
