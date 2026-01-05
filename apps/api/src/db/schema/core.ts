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
