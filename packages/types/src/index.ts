/**
 * @packageDocumentation
 * Shared TypeScript types for Project Athena.
 *
 * @remarks
 * This package contains all domain types and API types used across
 * the Athena platform. Import from subpaths for specific type categories:
 *
 * @example
 * ```typescript
 * import { Task, Project } from '@athena/types/domain';
 * import { CreateTaskInput, TaskResponse } from '@athena/types/api';
 * ```
 */

export * from './domain/index.js';
export * from './api/index.js';
