/**
 * API types for Project Athena.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  TaskPrioritySchema,
  TaskStatusSchema,
  ProjectStatusSchema,
  InitiativeStatusSchema,
} from '../domain/index.js';

// ============================================================================
// Task API Schemas
// ============================================================================

/** Schema for creating a task */
export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(5000).optional(),
  priority: TaskPrioritySchema.default('medium'),
  deadline: z.coerce.date().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  projectId: z.string().uuid().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

/** Schema for updating a task */
export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  deadline: z.coerce.date().optional().nullable(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
});

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

/** Schema for task response */
export const TaskResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  deadline: z.string().datetime().nullable(),
  estimatedMinutes: z.number().nullable(),
  projectId: z.string().uuid().nullable(),
  assigneeId: z.string().uuid().nullable(),
  creatorId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskResponse = z.infer<typeof TaskResponseSchema>;

// ============================================================================
// Project API Schemas
// ============================================================================

/** Schema for creating a project */
export const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(5000).optional(),
  deadline: z.coerce.date().optional(),
  initiativeId: z.string().uuid().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/** Schema for updating a project */
export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: ProjectStatusSchema.optional(),
  deadline: z.coerce.date().optional().nullable(),
  initiativeId: z.string().uuid().optional().nullable(),
});

export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

// ============================================================================
// Initiative API Schemas
// ============================================================================

/** Schema for creating an initiative */
export const CreateInitiativeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(5000).optional(),
  parentId: z.string().uuid().optional(),
});

export type CreateInitiativeInput = z.infer<typeof CreateInitiativeSchema>;

/** Schema for updating an initiative */
export const UpdateInitiativeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: InitiativeStatusSchema.optional(),
  parentId: z.string().uuid().optional().nullable(),
});

export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeSchema>;

// ============================================================================
// Event API Schemas
// ============================================================================

/** Schema for creating an event */
export const CreateEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(5000).optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date().optional(),
  isAllDay: z.boolean().default(false),
  location: z.string().max(500).optional(),
  recurrenceRule: z.string().optional(),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;

/** Schema for updating an event */
export const UpdateEventSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional().nullable(),
  isAllDay: z.boolean().optional(),
  location: z.string().max(500).optional().nullable(),
  recurrenceRule: z.string().optional().nullable(),
});

export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

// ============================================================================
// Common API Types
// ============================================================================

/** Pagination parameters */
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;

/** Error detail */
interface ErrorDetail {
  field: string;
  message: string;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
  links: {
    self: string;
    next?: string;
    prev?: string;
    first: string;
    last: string;
  };
}

/** Error response */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
  };
}

/** API error codes */
export const ErrorCode = {
  ValidationError: 'VALIDATION_ERROR',
  AuthenticationRequired: 'AUTHENTICATION_REQUIRED',
  InvalidToken: 'INVALID_TOKEN',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  RateLimited: 'RATE_LIMITED',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
