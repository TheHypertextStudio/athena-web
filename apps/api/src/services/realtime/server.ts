/**
 * WebSocket server for real-time updates.
 *
 * Uses Bun's native WebSocket support for optimal performance.
 *
 * @packageDocumentation
 */

import type {
  WebSocketMessage,
  WebSocketMessageType,
  SubscriptionChannel,
  ConnectionStats,
  WebSocketServerConfig,
  SubscribePayload,
  UnsubscribePayload,
  ErrorPayload,
  RealtimeEventEmitter,
} from './types.js';
import { auth } from '../../lib/auth.js';

/**
 * Generic WebSocket interface compatible with Bun's ServerWebSocket.
 */
export interface WebSocketConnection<T = unknown> {
  data: T;
  send(message: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

/**
 * WebSocket data attached to each connection.
 */
export interface WebSocketData {
  clientId: string;
  userId: string;
  subscriptions: Set<SubscriptionChannel>;
  connectedAt: Date;
  lastPingAt: Date;
}

/**
 * Real-time WebSocket server.
 */
export class RealtimeServer implements RealtimeEventEmitter {
  private readonly clients = new Map<string, WebSocketConnection<WebSocketData>>();
  private readonly userConnections = new Map<string, Set<string>>();
  private readonly config: WebSocketServerConfig;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<WebSocketServerConfig> = {}) {
    this.config = {
      path: '/ws',
      pingInterval: 30000,
      maxConnectionsPerUser: 5,
      connectionTimeout: 120000,
      ...config,
    };
  }

  /**
   * Start the ping interval for keeping connections alive.
   */
  start(): void {
    if (this.pingInterval) {
      return;
    }

    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, this.config.pingInterval);
  }

  /**
   * Stop the server and close all connections.
   */
  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close all connections
    for (const [, ws] of this.clients) {
      ws.close(1001, 'Server shutting down');
    }

    this.clients.clear();
    this.userConnections.clear();
  }

  /**
   * Handle new WebSocket connection.
   */
  handleOpen(ws: WebSocketConnection<WebSocketData>): void {
    const { clientId, userId } = ws.data;

    // Check max connections per user
    const userConns = this.userConnections.get(userId) ?? new Set();
    if (userConns.size >= this.config.maxConnectionsPerUser) {
      this.sendError(ws, 'CONNECTION_LIMIT', 'Maximum connections per user exceeded');
      ws.close(4008, 'Connection limit exceeded');
      return;
    }

    // Register client
    this.clients.set(clientId, ws);
    userConns.add(clientId);
    this.userConnections.set(userId, userConns);

    // Send connection confirmation
    this.send(ws, {
      type: 'subscribed',
      payload: {
        clientId,
        channels: [],
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle WebSocket message.
   */
  handleMessage(ws: WebSocketConnection<WebSocketData>, message: string | Buffer): void {
    try {
      const data = JSON.parse(message.toString()) as WebSocketMessage;

      switch (data.type) {
        case 'ping':
          this.handlePing(ws);
          break;
        case 'subscribe':
          this.handleSubscribe(ws, data.payload as SubscribePayload);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(ws, data.payload as UnsubscribePayload);
          break;
        default:
          this.sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${data.type}`);
      }
    } catch {
      this.sendError(ws, 'PARSE_ERROR', 'Failed to parse message');
    }
  }

  /**
   * Handle WebSocket close.
   */
  handleClose(ws: WebSocketConnection<WebSocketData>): void {
    const { clientId, userId } = ws.data;

    // Remove from clients
    this.clients.delete(clientId);

    // Remove from user connections
    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(clientId);
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  /**
   * Emit an event to all subscribed clients.
   */
  emit(
    channel: SubscriptionChannel,
    type: WebSocketMessageType,
    payload: unknown,
    userId?: string,
  ): void {
    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const [, ws] of this.clients) {
      // Check if subscribed to channel
      if (!ws.data.subscriptions.has(channel)) {
        continue;
      }

      // If userId specified, only send to that user
      if (userId && ws.data.userId !== userId) {
        continue;
      }

      this.send(ws, message);
    }
  }

  /**
   * Emit an event to a specific user.
   */
  emitToUser(userId: string, type: WebSocketMessageType, payload: unknown): void {
    const userConns = this.userConnections.get(userId);
    if (!userConns) {
      return;
    }

    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const clientId of userConns) {
      const ws = this.clients.get(clientId);
      if (ws) {
        this.send(ws, message);
      }
    }
  }

  /**
   * Broadcast an event to all connected clients.
   */
  broadcast(type: WebSocketMessageType, payload: unknown): void {
    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const [, ws] of this.clients) {
      this.send(ws, message);
    }
  }

  /**
   * Get connection statistics.
   */
  getStats(): ConnectionStats {
    const subscriptionCounts: Record<SubscriptionChannel, number> = {
      tasks: 0,
      projects: 0,
      events: 0,
      initiatives: 0,
      notifications: 0,
      timer: 0,
      sync: 0,
    };

    for (const [, ws] of this.clients) {
      for (const channel of ws.data.subscriptions) {
        const key = channel;
        if (key in subscriptionCounts) {
          subscriptionCounts[key]++;
        }
      }
    }

    return {
      totalConnections: this.clients.size,
      activeConnections: this.clients.size,
      connectionsByUser: new Map(
        Array.from(this.userConnections.entries()).map(([userId, conns]) => [userId, conns.size]),
      ),
      subscriptionCounts,
    };
  }

  /**
   * Authenticate a WebSocket connection from request headers.
   * WebSocket connections should pass auth via cookie or Authorization header.
   */
  async authenticate(request: Request): Promise<{ userId: string; clientId: string } | null> {
    try {
      // Try to get session using Better Auth
      const session = await auth.api.getSession({
        headers: request.headers,
      });

      if (!session?.user) {
        return null;
      }

      return {
        userId: session.user.id,
        clientId: crypto.randomUUID(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Create WebSocket data for a new connection.
   */
  createWebSocketData(userId: string, clientId: string): WebSocketData {
    return {
      clientId,
      userId,
      subscriptions: new Set(),
      connectedAt: new Date(),
      lastPingAt: new Date(),
    };
  }

  private handlePing(ws: WebSocketConnection<WebSocketData>): void {
    ws.data.lastPingAt = new Date();
    this.send(ws, {
      type: 'pong',
      timestamp: new Date().toISOString(),
    });
  }

  private handleSubscribe(ws: WebSocketConnection<WebSocketData>, payload: SubscribePayload): void {
    const validChannels: SubscriptionChannel[] = [
      'tasks',
      'projects',
      'events',
      'initiatives',
      'notifications',
      'timer',
      'sync',
    ];

    const channels = payload.channels.filter((c) => validChannels.includes(c));

    for (const channel of channels) {
      ws.data.subscriptions.add(channel);
    }

    this.send(ws, {
      type: 'subscribed',
      payload: {
        channels: Array.from(ws.data.subscriptions),
      },
      timestamp: new Date().toISOString(),
    });
  }

  private handleUnsubscribe(
    ws: WebSocketConnection<WebSocketData>,
    payload: UnsubscribePayload,
  ): void {
    for (const channel of payload.channels) {
      ws.data.subscriptions.delete(channel);
    }

    this.send(ws, {
      type: 'unsubscribed',
      payload: {
        channels: payload.channels,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private pingClients(): void {
    const now = new Date();
    const timeout = this.config.connectionTimeout;

    for (const [clientId, ws] of this.clients) {
      const lastPing = ws.data.lastPingAt.getTime();
      if (now.getTime() - lastPing > timeout) {
        // Connection timed out
        ws.close(4000, 'Connection timeout');
        this.clients.delete(clientId);
        continue;
      }

      // Send ping
      this.send(ws, {
        type: 'ping' as WebSocketMessageType,
        timestamp: now.toISOString(),
      });
    }
  }

  private send(ws: WebSocketConnection<WebSocketData>, message: WebSocketMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Connection may be closed
    }
  }

  private sendError(ws: WebSocketConnection<WebSocketData>, code: string, message: string): void {
    const payload: ErrorPayload = { code, message };
    this.send(ws, {
      type: 'error',
      payload,
      timestamp: new Date().toISOString(),
    });
  }
}

// Singleton instance
let realtimeServerInstance: RealtimeServer | null = null;

/**
 * Get the shared realtime server instance.
 */
export function getRealtimeServer(): RealtimeServer {
  realtimeServerInstance ??= new RealtimeServer();
  return realtimeServerInstance;
}

/**
 * Create a new realtime server with custom config.
 */
export function createRealtimeServer(config?: Partial<WebSocketServerConfig>): RealtimeServer {
  return new RealtimeServer(config);
}
