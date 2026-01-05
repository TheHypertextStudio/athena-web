# Code Style Guide

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Overview

This document defines the code style standards for Project Athena. Consistency improves readability, maintainability, and collaboration.

## General Principles

1. **Readability over cleverness** - Write code others can understand
2. **Explicit over implicit** - Be clear about intent
3. **Small, focused units** - Functions, components, modules
4. **Self-documenting code** - Good names reduce comment needs
5. **Fail fast** - Validate early, error clearly

## TypeScript Guidelines

### Strict Mode

TypeScript is configured with strict mode. All code must pass:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### Type Annotations

**Always annotate:**
- Function parameters
- Public function return types
- Class properties
- Exported types

**Let TypeScript infer:**
- Local variables with obvious types
- Return types of simple functions
- Array literals

```typescript
// Good: Explicit where it matters
export function calculatePriority(task: Task): Priority {
  const now = new Date();
  const isOverdue = task.deadline && task.deadline < now;
  return isOverdue ? 'high' : task.priority;
}

// Good: Inference for simple cases
const tasks = await getTasks();  // Type inferred from getTasks()
const count = tasks.length;      // Obviously number

// Bad: Over-annotating
const count: number = tasks.length;
const isValid: boolean = true;
```

### Avoid `any`

Never use `any`. Use proper types or `unknown`:

```typescript
// Bad
function parse(data: any): any {
  return JSON.parse(data);
}

// Good
function parse<T>(data: string): T {
  return JSON.parse(data) as T;
}

// Good: When truly unknown
function handleUnknown(value: unknown): void {
  if (typeof value === 'string') {
    console.log(value.toUpperCase());
  }
}
```

### Type vs Interface

- **`type`** for unions, intersections, primitives
- **`interface`** for objects, especially extensible ones

```typescript
// Type for unions and simple aliases
type Priority = 'low' | 'medium' | 'high';
type TaskId = string & { readonly brand: unique symbol };

// Interface for object shapes
interface Task {
  id: TaskId;
  title: string;
  priority: Priority;
}

// Interface for extensibility
interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Task extends BaseEntity {
  title: string;
  status: string;
}
```

### Branded Types

Use branded types for domain identifiers:

```typescript
// types/domain.ts
export type UserId = string & { readonly __brand: 'UserId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };

// Helper functions
export function createUserId(id: string): UserId {
  return id as UserId;
}

export function createTaskId(id: string): TaskId {
  return id as TaskId;
}
```

### Zod Schemas

Use Zod for runtime validation with type inference:

```typescript
import { z } from 'zod';

// Schema definition
export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  projectId: z.string().uuid().optional(),
  deadline: z.coerce.date().optional(),
});

// Inferred type
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

// Usage
function createTask(input: CreateTaskInput): Task {
  // TypeScript knows the exact shape
}
```

## Naming Conventions

### Variables and Functions

```typescript
// camelCase for variables and functions
const taskCount = 10;
const isCompleted = false;

function calculatePriority(task: Task): Priority { }
async function fetchUserTasks(userId: UserId): Promise<Task[]> { }

// Boolean variables: is, has, can, should
const isLoading = true;
const hasPermission = false;
const canEdit = true;
const shouldRefresh = false;

// Arrays: plural nouns
const tasks: Task[] = [];
const userIds: UserId[] = [];
```

### Types and Interfaces

```typescript
// PascalCase for types, interfaces, classes
type Priority = 'low' | 'medium' | 'high';
interface TaskRepository { }
class TaskService { }

// Descriptive, domain-focused names
interface CreateTaskInput { }  // Not: TaskCreateDTO
interface TaskListResponse { } // Not: GetTasksResult
```

### Constants

```typescript
// SCREAMING_SNAKE_CASE for true constants
const MAX_TITLE_LENGTH = 255;
const DEFAULT_PAGE_SIZE = 20;
const API_VERSION = 'v1';

// PascalCase for constant objects
const HttpStatus = {
  OK: 200,
  Created: 201,
  BadRequest: 400,
} as const;

const Priority = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
```

### Files and Directories

```typescript
// kebab-case for files
// task-service.ts
// create-task.ts
// use-tasks.ts

// Directory structure by feature
src/
├── features/
│   ├── tasks/
│   │   ├── task-service.ts
│   │   ├── task-repository.ts
│   │   ├── task-routes.ts
│   │   └── task.types.ts
│   └── calendar/
│       └── ...
└── shared/
    ├── middleware/
    └── utils/
```

## Function Guidelines

### Single Responsibility

```typescript
// Bad: Function does too much
async function processTask(task: Task) {
  await validateTask(task);
  await saveToDatabase(task);
  await notifyUser(task.assigneeId);
  await updateAnalytics(task);
}

// Good: Separate concerns
async function createTask(input: CreateTaskInput): Promise<Task> {
  const task = Task.create(input);
  return taskRepository.save(task);
}

async function onTaskCreated(task: Task): Promise<void> {
  await notificationService.notifyAssignee(task);
  await analyticsService.trackTaskCreation(task);
}
```

### Pure Functions

Prefer pure functions where possible:

```typescript
// Good: Pure function
function calculateDueDate(startDate: Date, durationDays: number): Date {
  const dueDate = new Date(startDate);
  dueDate.setDate(dueDate.getDate() + durationDays);
  return dueDate;
}

// Good: Side effects are explicit and isolated
async function updateTaskStatus(
  taskId: TaskId,
  status: TaskStatus,
  repository: TaskRepository,
): Promise<Task> {
  const task = await repository.findById(taskId);
  if (!task) {
    throw new NotFoundError('Task', taskId);
  }

  task.status = status;
  task.updatedAt = new Date();

  return repository.save(task);
}
```

### Error Handling

```typescript
// Define specific error types
export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string,
  ) {
    super(`Validation failed: ${field} - ${message}`);
    this.name = 'ValidationError';
  }
}

// Use specific errors
async function getTask(taskId: TaskId): Promise<Task> {
  const task = await repository.findById(taskId);

  if (!task) {
    throw new NotFoundError('Task', taskId);
  }

  return task;
}
```

## Documentation (TSDoc)

### Required Documentation

Document all:
- Exported functions
- Exported classes and their methods
- Exported types/interfaces
- Complex internal logic

### TSDoc Format

```typescript
/**
 * Creates a new task with the specified attributes.
 *
 * @remarks
 * The task will be created with a default status of 'pending' and
 * priority of 'medium' unless otherwise specified.
 *
 * @param input - The task creation parameters
 * @returns The created task with generated ID and timestamps
 *
 * @throws {ValidationError} If the title is empty or too long
 * @throws {NotFoundError} If the specified project doesn't exist
 *
 * @example
 * ```typescript
 * const task = await createTask({
 *   title: 'Implement authentication',
 *   projectId: 'project_123',
 *   priority: 'high',
 * });
 * ```
 */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  // ...
}
```

### When NOT to Document

Don't add obvious documentation:

```typescript
// Bad: Obvious documentation
/**
 * Gets the task ID.
 * @returns The task ID
 */
get id(): TaskId {
  return this._id;
}

// Good: Self-documenting
get id(): TaskId {
  return this._id;
}
```

## React Guidelines

### Component Structure

```typescript
// components/task-card.tsx
import { type FC } from 'react';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  onComplete?: (taskId: TaskId) => void;
  className?: string;
}

export const TaskCard: FC<TaskCardProps> = ({
  task,
  onComplete,
  className,
}) => {
  const handleComplete = () => {
    onComplete?.(task.id);
  };

  return (
    <div className={cn('rounded-lg border p-4', className)}>
      <h3 className="font-medium">{task.title}</h3>
      <p className="text-sm text-muted-foreground">
        {task.description}
      </p>
      <Button onClick={handleComplete}>Complete</Button>
    </div>
  );
};
```

### Server Components (Default)

```typescript
// app/tasks/page.tsx
import { TaskList } from '@/components/task-list';
import { getTasks } from '@/lib/api';

export default async function TasksPage() {
  const tasks = await getTasks();

  return (
    <main className="container py-8">
      <h1 className="text-2xl font-bold mb-4">Tasks</h1>
      <TaskList tasks={tasks} />
    </main>
  );
}
```

### Client Components (When Needed)

```typescript
// components/task-form.tsx
'use client';

import { useFormState } from 'react-dom';
import { createTaskAction } from '@/app/actions';

export function TaskForm() {
  const [state, formAction] = useFormState(createTaskAction, null);

  return (
    <form action={formAction}>
      <Input name="title" placeholder="Task title" />
      {state?.error && (
        <p className="text-destructive">{state.error}</p>
      )}
      <Button type="submit">Create Task</Button>
    </form>
  );
}
```

### Server Actions

```typescript
// app/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { CreateTaskSchema } from '@athena/types';
import { createTask } from '@/lib/api';

export async function createTaskAction(
  prevState: unknown,
  formData: FormData,
) {
  const result = CreateTaskSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
  });

  if (!result.success) {
    return { error: result.error.flatten().fieldErrors };
  }

  await createTask(result.data);
  revalidatePath('/tasks');

  return { success: true };
}
```

## Testing Style

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TaskService', () => {
  let service: TaskService;
  let mockRepository: MockTaskRepository;

  beforeEach(() => {
    mockRepository = createMockTaskRepository();
    service = new TaskService(mockRepository);
  });

  describe('createTask', () => {
    it('creates a task with default priority when not specified', async () => {
      // Arrange
      const input = { title: 'Test Task' };

      // Act
      const task = await service.createTask(input);

      // Assert
      expect(task.priority).toBe('medium');
    });

    it('throws ValidationError when title is empty', async () => {
      // Arrange
      const input = { title: '' };

      // Act & Assert
      await expect(service.createTask(input))
        .rejects.toThrow(ValidationError);
    });
  });
});
```

## Import Order

Organize imports in this order:
1. Node.js built-ins
2. External dependencies
3. Internal packages (`@athena/*`)
4. Relative imports

```typescript
// 1. Node built-ins
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// 2. External dependencies
import { Hono } from 'hono';
import { z } from 'zod';

// 3. Internal packages
import { TaskSchema } from '@athena/types';
import { logger } from '@athena/shared';

// 4. Relative imports
import { TaskRepository } from './task-repository';
import { validateTask } from './validation';
```

## ESLint Configuration

```javascript
// eslint.config.js
export default [
  {
    rules: {
      // Enforce consistent type imports
      '@typescript-eslint/consistent-type-imports': 'error',

      // No unused variables (with exceptions)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],

      // Require explicit return types on public APIs
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // No floating promises
      '@typescript-eslint/no-floating-promises': 'error',

      // Prefer nullish coalescing
      '@typescript-eslint/prefer-nullish-coalescing': 'error',

      // Prefer optional chaining
      '@typescript-eslint/prefer-optional-chain': 'error',
    },
  },
];
```

---

*See also: [Development Workflow](./workflow.md), [Testing Strategy](../engineering/testing-strategy.md)*
