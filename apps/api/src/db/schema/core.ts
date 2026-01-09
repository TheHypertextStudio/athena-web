/**
 * Core domain schema for Project Athena.
 *
 * @packageDocumentation
 */

import { pgTable, text, timestamp, boolean, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';

// ============================================================================
// Enums
// ============================================================================

export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);
export const projectStatusEnum = pgEnum('project_status', [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);
export const initiativeStatusEnum = pgEnum('initiative_status', [
  'draft',
  'active',
  'completed',
  'archived',
]);

// ============================================================================
// Tables
// ============================================================================

/**
 * Initiatives - Strategic collections of projects.
 */
export const initiatives = pgTable('initiatives', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: initiativeStatusEnum('status').notNull().default('draft'),
  parentId: text('parent_id'),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Projects - Time-bound collections of tasks.
 */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: projectStatusEnum('status').notNull().default('planning'),
  deadline: timestamp('deadline'),
  initiativeId: text('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Tasks - Completable units of work.
 */
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').notNull().default('pending'),
  priority: taskPriorityEnum('priority').notNull().default('medium'),
  deadline: timestamp('deadline'),
  estimatedMinutes: integer('estimated_minutes'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  creatorId: text('creator_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Recurrence fields (RRULE format)
  /** RRULE string for recurring tasks (RFC 5545) */
  recurrenceRule: text('recurrence_rule'),
  /** Parent task ID for recurring task instances */
  parentTaskId: text('parent_task_id'),
  /** The specific date this instance represents (for recurring task instances) */
  instanceDate: timestamp('instance_date'),

  // Soft delete
  /** When this task was deleted (null = not deleted) */
  deletedAt: timestamp('deleted_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Events - Scheduled moments with participants.
 */
export const events = pgTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  isAllDay: boolean('is_all_day').notNull().default(false),
  location: text('location'),
  recurrenceRule: text('recurrence_rule'),
  creatorId: text('creator_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Source of the event: 'local' for user-created, 'external' for synced from external calendar */
  source: text('source').notNull().default('local'),
  /** Integration ID if synced from an external calendar */
  sourceIntegrationId: text('source_integration_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Moments - Time-bounded containers.
 */
export const moments = pgTable('moments', {
  id: text('id').primaryKey(),
  label: text('label'),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Activity Streams - Collections of activities from a single source.
 */
export const activityStreams = pgTable('activity_streams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  source: text('source').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Activities - Actions performed at a particular time.
 */
export const activities = pgTable('activities', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  metadata: jsonb('metadata'),
  streamId: text('stream_id')
    .notNull()
    .references(() => activityStreams.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Event Participants - Users participating in events.
 */
export const eventParticipants = pgTable('event_participants', {
  id: text('id').primaryKey(),
  eventId: text('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // pending, accepted, declined, tentative
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Task Tags - Tags for organizing tasks.
 */
export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color'),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Task-Tag associations.
 */
export const taskTags = pgTable('task_tags', {
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  tagId: text('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
});

// ============================================================================
// Relations
// ============================================================================

export const initiativeRelations = relations(initiatives, ({ one, many }) => ({
  owner: one(users, {
    fields: [initiatives.ownerId],
    references: [users.id],
  }),
  parent: one(initiatives, {
    fields: [initiatives.parentId],
    references: [initiatives.id],
    relationName: 'initiativeHierarchy',
  }),
  children: many(initiatives, { relationName: 'initiativeHierarchy' }),
  projects: many(projects),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  initiative: one(initiatives, {
    fields: [projects.initiativeId],
    references: [initiatives.id],
  }),
  tasks: many(tasks),
  dependencies: many(projectDependencies, { relationName: 'projectDependencies' }),
  dependents: many(projectDependencies, { relationName: 'projectDependents' }),
}));

export const taskRelations = relations(tasks, ({ one, many }) => ({
  creator: one(users, {
    fields: [tasks.creatorId],
    references: [users.id],
    relationName: 'taskCreator',
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
    relationName: 'taskAssignee',
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  tags: many(taskTags),
  dependencies: many(taskDependencies, { relationName: 'taskDependencies' }),
  dependents: many(taskDependencies, { relationName: 'taskDependents' }),
}));

export const eventRelations = relations(events, ({ one, many }) => ({
  creator: one(users, {
    fields: [events.creatorId],
    references: [users.id],
  }),
  participants: many(eventParticipants),
}));

export const momentRelations = relations(moments, ({ one }) => ({
  owner: one(users, {
    fields: [moments.ownerId],
    references: [users.id],
  }),
}));

export const activityStreamRelations = relations(activityStreams, ({ one, many }) => ({
  owner: one(users, {
    fields: [activityStreams.ownerId],
    references: [users.id],
  }),
  activities: many(activities),
}));

export const activityRelations = relations(activities, ({ one }) => ({
  stream: one(activityStreams, {
    fields: [activities.streamId],
    references: [activityStreams.id],
  }),
}));

export const eventParticipantRelations = relations(eventParticipants, ({ one }) => ({
  event: one(events, {
    fields: [eventParticipants.eventId],
    references: [events.id],
  }),
  user: one(users, {
    fields: [eventParticipants.userId],
    references: [users.id],
  }),
}));

export const tagRelations = relations(tags, ({ one, many }) => ({
  owner: one(users, {
    fields: [tags.ownerId],
    references: [users.id],
  }),
  tasks: many(taskTags),
}));

export const taskTagRelations = relations(taskTags, ({ one }) => ({
  task: one(tasks, {
    fields: [taskTags.taskId],
    references: [tasks.id],
  }),
  tag: one(tags, {
    fields: [taskTags.tagId],
    references: [tags.id],
  }),
}));

// ============================================================================
// Time Blocks
// ============================================================================

/**
 * Time Blocks - Designated periods of time for focused work.
 * Unlike calendar events, time blocks are private and not visible to others.
 */
export const timeBlocks = pgTable('time_blocks', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  /** Optional color for UI display */
  color: text('color'),
  /** Whether this time block repeats */
  recurrenceRule: text('recurrence_rule'),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Time Block Tasks - Tasks assigned to a specific time block.
 */
export const timeBlockTasks = pgTable('time_block_tasks', {
  id: text('id').primaryKey(),
  timeBlockId: text('time_block_id')
    .notNull()
    .references(() => timeBlocks.id, { onDelete: 'cascade' }),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  /** Order within the time block */
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const timeBlockRelations = relations(timeBlocks, ({ one, many }) => ({
  owner: one(users, {
    fields: [timeBlocks.ownerId],
    references: [users.id],
  }),
  tasks: many(timeBlockTasks),
}));

export const timeBlockTaskRelations = relations(timeBlockTasks, ({ one }) => ({
  timeBlock: one(timeBlocks, {
    fields: [timeBlockTasks.timeBlockId],
    references: [timeBlocks.id],
  }),
  task: one(tasks, {
    fields: [timeBlockTasks.taskId],
    references: [tasks.id],
  }),
}));

// ============================================================================
// Task Dependencies
// ============================================================================

/**
 * Task dependencies - defines prerequisite relationships between tasks.
 * If task A depends on task B, B must be completed before A can start.
 */
export const taskDependencies = pgTable('task_dependencies', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  dependsOnTaskId: text('depends_on_task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const taskDependencyRelations = relations(taskDependencies, ({ one }) => ({
  task: one(tasks, {
    fields: [taskDependencies.taskId],
    references: [tasks.id],
    relationName: 'taskDependencies',
  }),
  dependsOnTask: one(tasks, {
    fields: [taskDependencies.dependsOnTaskId],
    references: [tasks.id],
    relationName: 'taskDependents',
  }),
}));

// ============================================================================
// Project Dependencies
// ============================================================================

/**
 * Project dependencies - defines prerequisite relationships between projects.
 */
export const projectDependencies = pgTable('project_dependencies', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  dependsOnProjectId: text('depends_on_project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projectDependencyRelations = relations(projectDependencies, ({ one }) => ({
  project: one(projects, {
    fields: [projectDependencies.projectId],
    references: [projects.id],
    relationName: 'projectDependencies',
  }),
  dependsOnProject: one(projects, {
    fields: [projectDependencies.dependsOnProjectId],
    references: [projects.id],
    relationName: 'projectDependents',
  }),
}));

// ============================================================================
// Onboarding Progress
// ============================================================================

/**
 * Onboarding progress - tracks user's onboarding state.
 */
export const onboardingProgress = pgTable('onboarding_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  currentStep: text('current_step').notNull().default('welcome'),
  completedSteps: text('completed_steps').array().notNull().default([]),
  skippedAt: timestamp('skipped_at'),
  completedAt: timestamp('completed_at'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const onboardingProgressRelations = relations(onboardingProgress, ({ one }) => ({
  user: one(users, {
    fields: [onboardingProgress.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// User Settings & Preferences
// ============================================================================

/**
 * User settings and preferences.
 */
export const userSettings = pgTable('user_settings', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  preferredName: text('preferred_name'),
  timezone: text('timezone').notNull().default('UTC'),
  dailyPlanningTime: text('daily_planning_time'), // HH:MM format
  dailyReviewTime: text('daily_review_time'), // HH:MM format
  encryptionEnabled: boolean('encryption_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Billing & Subscriptions
// ============================================================================

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'canceled',
  'trialing',
  'paused',
]);

export const planTierEnum = pgEnum('plan_tier', ['free', 'pro', 'team']);

/**
 * User subscriptions - Stripe-backed billing.
 */
export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  planTier: planTierEnum('plan_tier').notNull().default('free'),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const subscriptionRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Time Tracking
// ============================================================================

/**
 * Time entries - tracking time spent on tasks.
 */
export const timeEntries = pgTable('time_entries', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const timeEntryRelations = relations(timeEntries, ({ one }) => ({
  task: one(tasks, {
    fields: [timeEntries.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [timeEntries.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Workspaces
// ============================================================================

/**
 * Workspaces - scoped views of work.
 */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const workspaceRelations = relations(workspaces, ({ one }) => ({
  owner: one(users, {
    fields: [workspaces.ownerId],
    references: [users.id],
  }),
}));

// ============================================================================
// Account Linking (Third-Party Integrations)
// ============================================================================

export const integrationProviderEnum = pgEnum('integration_provider', [
  // Productivity
  'linear',
  'github',
  'todoist',
  'asana',
  'jira',
  'trello',
  // Calendar
  'google_calendar',
  'outlook_calendar',
  'apple_calendar',
  // Communication
  'slack',
  'zoom',
  // Storage
  'google_drive',
  'dropbox',
  // Design
  'figma',
]);

/**
 * Linked integrations - third-party service connections.
 */
export const linkedIntegrations = pgTable('linked_integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: integrationProviderEnum('provider').notNull(),
  externalAccountId: text('external_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  scopes: text('scopes'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const linkedIntegrationRelations = relations(linkedIntegrations, ({ one, many }) => ({
  user: one(users, {
    fields: [linkedIntegrations.userId],
    references: [users.id],
  }),
  externalMappings: many(externalIdMappings),
}));

// ============================================================================
// External ID Mappings (for bi-directional sync)
// ============================================================================

export const entityTypeEnum = pgEnum('entity_type', [
  'task',
  'project',
  'event',
  'activity',
  'initiative',
]);

export const syncDirectionEnum = pgEnum('sync_direction', [
  'inbound', // External -> Local only
  'outbound', // Local -> External only
  'bidirectional', // Both directions
]);

/**
 * External ID mappings - tracks relationships between local entities and external service entities.
 * Essential for bi-directional sync to know which external item maps to which local item.
 */
export const externalIdMappings = pgTable('external_id_mappings', {
  id: text('id').primaryKey(),
  /** Reference to the linked integration */
  integrationId: text('integration_id')
    .notNull()
    .references(() => linkedIntegrations.id, { onDelete: 'cascade' }),
  /** The type of local entity (task, project, event, etc.) */
  entityType: entityTypeEnum('entity_type').notNull(),
  /** The local entity ID */
  localEntityId: text('local_entity_id').notNull(),
  /** The external service's ID for this entity */
  externalId: text('external_id').notNull(),
  /** The sync direction for this mapping */
  syncDirection: syncDirectionEnum('sync_direction').notNull().default('bidirectional'),
  /** Last time this entity was synced from external service */
  lastSyncedFromExternal: timestamp('last_synced_from_external'),
  /** Last time this entity was synced to external service */
  lastSyncedToExternal: timestamp('last_synced_to_external'),
  /** Version/ETag from external service for conflict detection */
  externalVersion: text('external_version'),
  /** Additional metadata about the mapping */
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const externalIdMappingRelations = relations(externalIdMappings, ({ one }) => ({
  integration: one(linkedIntegrations, {
    fields: [externalIdMappings.integrationId],
    references: [linkedIntegrations.id],
  }),
}));

// ============================================================================
// Calendar Sync Tokens (for incremental sync)
// ============================================================================

/**
 * Calendar sync tokens - persists incremental sync state per calendar.
 * Google Calendar and other providers use sync tokens to efficiently fetch only changed events.
 */
export const calendarSyncTokens = pgTable('calendar_sync_tokens', {
  id: text('id').primaryKey(),
  /** Reference to the linked integration */
  integrationId: text('integration_id')
    .notNull()
    .references(() => linkedIntegrations.id, { onDelete: 'cascade' }),
  /** External calendar ID (e.g., Google Calendar ID) */
  calendarId: text('calendar_id').notNull(),
  /** The sync token from the calendar provider */
  syncToken: text('sync_token').notNull(),
  /** Last successful sync timestamp */
  lastSyncAt: timestamp('last_sync_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const calendarSyncTokenRelations = relations(calendarSyncTokens, ({ one }) => ({
  integration: one(linkedIntegrations, {
    fields: [calendarSyncTokens.integrationId],
    references: [linkedIntegrations.id],
  }),
}));

// ============================================================================
// Agenda Task Ordering
// ============================================================================

/**
 * Agenda task order - stores user's custom task ordering per date.
 * Allows users to manually prioritize their daily agenda.
 */
export const agendaTaskOrder = pgTable('agenda_task_order', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** The date this ordering applies to (YYYY-MM-DD format stored as date) */
  agendaDate: timestamp('agenda_date').notNull(),
  /** Task ID */
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  /** Position in the agenda (0 = first) */
  position: integer('position').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agendaTaskOrderRelations = relations(agendaTaskOrder, ({ one }) => ({
  user: one(users, {
    fields: [agendaTaskOrder.userId],
    references: [users.id],
  }),
  task: one(tasks, {
    fields: [agendaTaskOrder.taskId],
    references: [tasks.id],
  }),
}));
