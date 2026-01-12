import { and, eq, isNull } from 'drizzle-orm';
import type { AthenaMcpSchema } from './types.js';

export const taskOwnerScope = (tasks: AthenaMcpSchema['tasks'], userId: string) =>
  eq(tasks.creatorId, userId);

export const taskScope = (tasks: AthenaMcpSchema['tasks'], userId: string) =>
  and(taskOwnerScope(tasks, userId), isNull(tasks.deletedAt));

export const projectOwnerScope = (projects: AthenaMcpSchema['projects'], userId: string) =>
  eq(projects.ownerId, userId);

export const projectScope = (projects: AthenaMcpSchema['projects'], userId: string) =>
  and(projectOwnerScope(projects, userId), isNull(projects.deletedAt));

export const initiativeOwnerScope = (initiatives: AthenaMcpSchema['initiatives'], userId: string) =>
  eq(initiatives.ownerId, userId);

export const initiativeScope = (initiatives: AthenaMcpSchema['initiatives'], userId: string) =>
  and(initiativeOwnerScope(initiatives, userId), isNull(initiatives.deletedAt));

export const eventScope = (events: AthenaMcpSchema['events'], userId: string) =>
  eq(events.creatorId, userId);
