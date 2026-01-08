/**
 * Event helpers for broadcasting entity changes.
 *
 * @packageDocumentation
 */

import { getRealtimeServer } from './server.js';
import type { SubscriptionChannel, WebSocketMessageType } from './types.js';

/**
 * Broadcast a task event.
 */
export function emitTaskEvent(
  action: 'created' | 'updated' | 'deleted' | 'completed',
  task: unknown,
  userId: string,
): void {
  const server = getRealtimeServer();
  const type = `task.${action}` as WebSocketMessageType;
  server.emit('tasks', type, task, userId);
}

/**
 * Broadcast a project event.
 */
export function emitProjectEvent(
  action: 'created' | 'updated' | 'deleted',
  project: unknown,
  userId: string,
): void {
  const server = getRealtimeServer();
  const type = `project.${action}` as WebSocketMessageType;
  server.emit('projects', type, project, userId);
}

/**
 * Broadcast an event event (calendar events).
 */
export function emitCalendarEvent(
  action: 'created' | 'updated' | 'deleted',
  event: unknown,
  userId: string,
): void {
  const server = getRealtimeServer();
  const type = `event.${action}` as WebSocketMessageType;
  server.emit('events', type, event, userId);
}

/**
 * Broadcast an initiative event.
 */
export function emitInitiativeEvent(
  action: 'created' | 'updated' | 'deleted',
  initiative: unknown,
  userId: string,
): void {
  const server = getRealtimeServer();
  const type = `initiative.${action}` as WebSocketMessageType;
  server.emit('initiatives', type, initiative, userId);
}

/**
 * Broadcast a notification event.
 */
export function emitNotificationEvent(
  action: 'created' | 'read',
  notification: unknown,
  userId: string,
): void {
  const server = getRealtimeServer();
  const type = `notification.${action}` as WebSocketMessageType;
  server.emit('notifications', type, notification, userId);
}

/**
 * Broadcast a timer event.
 */
export function emitTimerEvent(
  action: 'started' | 'stopped' | 'paused',
  timer: unknown,
  userId: string,
): void {
  const server = getRealtimeServer();
  const type = `timer.${action}` as WebSocketMessageType;
  server.emit('timer', type, timer, userId);
}

/**
 * Broadcast a sync event to a specific user.
 */
export function emitSyncEvent(type: 'full' | 'partial', data: unknown, userId: string): void {
  const server = getRealtimeServer();
  const msgType = `sync.${type}` as WebSocketMessageType;
  server.emitToUser(userId, msgType, data);
}

/**
 * Generic entity event emitter.
 */
export function emitEntityEvent(
  channel: SubscriptionChannel,
  type: WebSocketMessageType,
  data: unknown,
  userId?: string,
): void {
  const server = getRealtimeServer();
  server.emit(channel, type, data, userId);
}
