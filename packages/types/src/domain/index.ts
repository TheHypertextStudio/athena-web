/**
 * Domain types for Project Athena.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// Branded Types
// ============================================================================

/** Branded type for User IDs */
export type UserId = string & { readonly __brand: 'UserId' };

/** Branded type for Task IDs */
export type TaskId = string & { readonly __brand: 'TaskId' };

/** Branded type for Project IDs */
export type ProjectId = string & { readonly __brand: 'ProjectId' };

/** Branded type for Initiative IDs */
export type InitiativeId = string & { readonly __brand: 'InitiativeId' };

/** Branded type for Event IDs */
export type EventId = string & { readonly __brand: 'EventId' };

/** Branded type for Activity IDs */
export type ActivityId = string & { readonly __brand: 'ActivityId' };

/** Branded type for Activity Stream IDs */
export type ActivityStreamId = string & { readonly __brand: 'ActivityStreamId' };

/** Branded type for Moment IDs */
export type MomentId = string & { readonly __brand: 'MomentId' };

// ============================================================================
// Enums
// ============================================================================

/** Task priority levels */
export const TaskPriority = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Urgent: 'urgent',
} as const;

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

/** Task status values (legacy - use TaskStatusCategory for new code) */
export const TaskStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * System-defined task status categories.
 * Custom statuses must map to one of these immutable categories.
 * Used for filtering, reporting, and provider sync.
 */
export const TaskStatusCategory = {
  NotStarted: 'not_started',
  InProgress: 'in_progress',
  Done: 'done',
  Cancelled: 'cancelled',
} as const;

export type TaskStatusCategory = (typeof TaskStatusCategory)[keyof typeof TaskStatusCategory];

/** Branded type for Custom Task Status IDs */
export type CustomTaskStatusId = string & { readonly __brand: 'CustomTaskStatusId' };

/** Branded type for Workspace IDs */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

/** Project status values */
export const ProjectStatus = {
  Planning: 'planning',
  Active: 'active',
  OnHold: 'on_hold',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

/** Initiative status values */
export const InitiativeStatus = {
  Draft: 'draft',
  Active: 'active',
  Completed: 'completed',
  Archived: 'archived',
} as const;

export type InitiativeStatus = (typeof InitiativeStatus)[keyof typeof InitiativeStatus];

// ============================================================================
// Base Entity
// ============================================================================

/** Base fields for all entities */
export interface BaseEntity {
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Domain Entities
// ============================================================================

/** A user in the system */
export interface User extends BaseEntity {
  id: UserId;
  email: string;
  name: string;
  avatarUrl?: string;
}

/** A completable unit of work */
export interface Task extends BaseEntity {
  id: TaskId;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline?: Date;
  estimatedMinutes?: number;
  projectId?: ProjectId;
  assigneeId?: UserId;
  creatorId: UserId;
}

/** A time-bound collection of tasks */
export interface Project extends BaseEntity {
  id: ProjectId;
  name: string;
  description?: string;
  status: ProjectStatus;
  deadline?: Date;
  initiativeId?: InitiativeId;
  ownerId: UserId;
}

/** A strategic collection of projects */
export interface Initiative extends BaseEntity {
  id: InitiativeId;
  name: string;
  description?: string;
  status: InitiativeStatus;
  parentId?: InitiativeId;
  ownerId: UserId;
}

/** A scheduled moment with participants */
export interface Event extends BaseEntity {
  id: EventId;
  title: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  isAllDay: boolean;
  location?: string;
  recurrenceRule?: string;
  creatorId: UserId;
}

/** A time-bounded container */
export interface Moment extends BaseEntity {
  id: MomentId;
  label?: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  ownerId: UserId;
}

/** An activity performed at a particular time */
export interface Activity extends BaseEntity {
  id: ActivityId;
  type: string;
  startTime: Date;
  endTime: Date;
  metadata?: Record<string, unknown>;
  streamId: ActivityStreamId;
}

/** A collection of activities from a single source */
export interface ActivityStream extends BaseEntity {
  id: ActivityStreamId;
  name: string;
  source: string;
  ownerId: UserId;
}

/** A daily collection of tasks and events */
export interface Agenda {
  date: Date;
  tasks: Task[];
  events: Event[];
  moments: Moment[];
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export const TaskStatusCategorySchema = z.enum(['not_started', 'in_progress', 'done', 'cancelled']);
export const ProjectStatusSchema = z.enum([
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);
export const InitiativeStatusSchema = z.enum(['draft', 'active', 'completed', 'archived']);
