/**
 * Real-time sync types.
 *
 * @packageDocumentation
 */

/**
 * WebSocket message types for client-server communication.
 */
export type WebSocketMessageType =
  // Client -> Server
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  // Server -> Client
  | 'pong'
  | 'subscribed'
  | 'unsubscribed'
  | 'error'
  // Entity events
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.completed'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'event.created'
  | 'event.updated'
  | 'event.deleted'
  | 'initiative.created'
  | 'initiative.updated'
  | 'initiative.deleted'
  | 'notification.created'
  | 'notification.read'
  | 'timer.started'
  | 'timer.stopped'
  | 'timer.paused'
  | 'sync.full'
  | 'sync.partial';

/**
 * Channels that clients can subscribe to.
 */
export type SubscriptionChannel =
  | 'tasks'
  | 'projects'
  | 'events'
  | 'initiatives'
  | 'notifications'
  | 'timer'
  | 'sync';

/**
 * Base WebSocket message structure.
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  payload?: T;
  timestamp: string;
  messageId?: string;
}

/**
 * Subscribe message payload.
 */
export interface SubscribePayload {
  channels: SubscriptionChannel[];
}

/**
 * Unsubscribe message payload.
 */
export interface UnsubscribePayload {
  channels: SubscriptionChannel[];
}

/**
 * Entity event payload.
 */
export interface EntityEventPayload<T = unknown> {
  entityType: 'task' | 'project' | 'event' | 'initiative' | 'notification' | 'timer';
  entityId: string;
  data: T;
  action: 'created' | 'updated' | 'deleted';
}

/**
 * Sync event payload.
 */
export interface SyncPayload {
  entities: {
    tasks?: unknown[];
    projects?: unknown[];
    events?: unknown[];
    initiatives?: unknown[];
    notifications?: unknown[];
  };
  lastSyncAt: string;
}

/**
 * Error payload.
 */
export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Connected client information.
 */
export interface ConnectedClient {
  id: string;
  userId: string;
  subscriptions: Set<SubscriptionChannel>;
  connectedAt: Date;
  lastPingAt: Date;
}

/**
 * Connection stats.
 */
export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  connectionsByUser: Map<string, number>;
  subscriptionCounts: Record<SubscriptionChannel, number>;
}

/**
 * WebSocket server configuration.
 */
export interface WebSocketServerConfig {
  /**
   * Path for WebSocket connections.
   */
  path: string;

  /**
   * Ping interval in milliseconds.
   */
  pingInterval: number;

  /**
   * Maximum connections per user.
   */
  maxConnectionsPerUser: number;

  /**
   * Connection timeout in milliseconds.
   */
  connectionTimeout: number;
}

/**
 * Event emitter for broadcasting events.
 */
export interface RealtimeEventEmitter {
  /**
   * Emit an event to all subscribed clients.
   */
  emit(
    channel: SubscriptionChannel,
    type: WebSocketMessageType,
    payload: unknown,
    userId?: string,
  ): void;

  /**
   * Emit an event to a specific user.
   */
  emitToUser(userId: string, type: WebSocketMessageType, payload: unknown): void;

  /**
   * Broadcast an event to all connected clients.
   */
  broadcast(type: WebSocketMessageType, payload: unknown): void;
}
