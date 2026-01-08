/**
 * Calendar sync service.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { events, linkedIntegrations } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { GoogleCalendarProvider } from './providers/google.js';
import { OutlookCalendarProvider } from './providers/outlook.js';
import { ICloudCalendarProvider } from './providers/icloud.js';
import { CalDAVProvider } from './providers/caldav.js';
import type {
  CalendarProvider,
  CalendarProviderClient,
  CalendarConnection,
  SyncedCalendar,
  SyncResult,
  ExternalCalendarEvent,
} from './types.js';
import { env } from '../../lib/env.js';

/**
 * Calendar sync configuration.
 */
export interface CalendarSyncConfig {
  google?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  outlook?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  icloud?: {
    enabled: boolean;
  };
  caldav?: {
    enabled: boolean;
  };
}

/**
 * Calendar sync service.
 */
export class CalendarSyncService {
  private readonly providers: Map<CalendarProvider, CalendarProviderClient>;
  private readonly syncTokens: Map<string, string>; // connectionId:calendarId -> syncToken

  constructor(config: CalendarSyncConfig) {
    this.providers = new Map();
    this.syncTokens = new Map();

    // Initialize Google provider
    if (config.google) {
      this.providers.set(
        'google',
        new GoogleCalendarProvider({
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          redirectUri: config.google.redirectUri,
          scopes: [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/calendar.events',
          ],
        }),
      );
    }

    // Initialize Outlook provider
    if (config.outlook) {
      this.providers.set(
        'outlook',
        new OutlookCalendarProvider({
          clientId: config.outlook.clientId,
          clientSecret: config.outlook.clientSecret,
          redirectUri: config.outlook.redirectUri,
          scopes: ['offline_access', 'Calendars.ReadWrite'],
        }),
      );
    }

    // Initialize iCloud provider (CalDAV-based, uses app-specific passwords)
    if (config.icloud?.enabled !== false) {
      this.providers.set('icloud', new ICloudCalendarProvider());
    }

    // Initialize generic CalDAV provider
    if (config.caldav?.enabled !== false) {
      this.providers.set('caldav', new CalDAVProvider());
    }
  }

  /**
   * Get OAuth authorization URL for a provider.
   */
  getAuthUrl(provider: CalendarProvider, userId: string): string {
    const client = this.providers.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    // Generate state token with user ID for security
    const state = Buffer.from(JSON.stringify({ userId, provider, timestamp: Date.now() })).toString(
      'base64url',
    );

    return client.getAuthUrl(state);
  }

  /**
   * Handle OAuth callback and create connection.
   */
  async handleOAuthCallback(
    provider: CalendarProvider,
    code: string,
    state: string,
  ): Promise<CalendarConnection> {
    const client = this.providers.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    // Decode and validate state
    let stateData: { userId: string; provider: string; timestamp: number };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString()) as {
        userId: string;
        provider: string;
        timestamp: number;
      };
    } catch {
      throw new Error('Invalid state token');
    }

    // Verify state is recent (within 10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      throw new Error('State token expired');
    }

    // Exchange code for tokens
    const tokens = await client.exchangeCode(code);

    // Get list of calendars
    const calendars = await client.listCalendars(tokens.accessToken);

    // Store connection
    const connectionId = crypto.randomUUID();
    const now = new Date();

    // Map provider to integration provider enum
    const providerMap: Record<CalendarProvider, string> = {
      google: 'google_calendar',
      outlook: 'outlook_calendar',
      icloud: 'apple_calendar',
      caldav: 'google_calendar', // CalDAV doesn't have its own enum, use a placeholder
    };

    await db.insert(linkedIntegrations).values({
      id: connectionId,
      userId: stateData.userId,
      provider: providerMap[provider] as 'google_calendar' | 'outlook_calendar' | 'apple_calendar',
      externalAccountId: calendars.find((c) => c.isPrimary)?.externalId ?? 'default',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scope,
      metadata: { calendars: calendars.map((c) => ({ ...c, syncEnabled: c.isPrimary })) },
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: connectionId,
      userId: stateData.userId,
      provider,
      externalAccountId: calendars.find((c) => c.isPrimary)?.externalId ?? 'default',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      syncEnabled: true,
      calendars: calendars.map((c) => ({ ...c, syncEnabled: c.isPrimary })),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get user's calendar connections.
   */
  async getConnections(userId: string): Promise<CalendarConnection[]> {
    const integrations = await db.query.linkedIntegrations.findMany({
      where: eq(linkedIntegrations.userId, userId),
    });

    return integrations
      .filter((i) => ['google_calendar', 'outlook_calendar', 'apple_calendar'].includes(i.provider))
      .map((i) => ({
        id: i.id,
        userId: i.userId,
        provider: this.mapIntegrationToProvider(i.provider),
        externalAccountId: i.externalAccountId,
        accessToken: i.accessToken ?? undefined,
        refreshToken: i.refreshToken ?? undefined,
        tokenExpiresAt: i.tokenExpiresAt ?? undefined,
        syncEnabled: true,
        calendars: (i.metadata as { calendars?: SyncedCalendar[] }).calendars ?? [],
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }));
  }

  /**
   * Update calendars to sync.
   */
  async updateSyncSettings(
    connectionId: string,
    userId: string,
    calendars: {
      id: string;
      syncEnabled: boolean;
      syncDirection: 'pull' | 'push' | 'bidirectional';
    }[],
  ): Promise<void> {
    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      throw new Error('Connection not found');
    }

    const existingCalendars =
      (integration.metadata as { calendars?: SyncedCalendar[] }).calendars ?? [];

    const updatedCalendars = existingCalendars.map((cal) => {
      const update = calendars.find((c) => c.id === cal.id);
      if (update) {
        return { ...cal, syncEnabled: update.syncEnabled, syncDirection: update.syncDirection };
      }
      return cal;
    });

    await db
      .update(linkedIntegrations)
      .set({
        metadata: { calendars: updatedCalendars },
        updatedAt: new Date(),
      })
      .where(eq(linkedIntegrations.id, connectionId));
  }

  /**
   * Disconnect a calendar provider.
   */
  async disconnect(connectionId: string, userId: string): Promise<void> {
    await db
      .delete(linkedIntegrations)
      .where(and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)));
  }

  /**
   * Sync events for a connection.
   */
  async sync(connectionId: string, userId: string): Promise<SyncResult> {
    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      throw new Error('Connection not found');
    }

    const provider = this.mapIntegrationToProvider(integration.provider);
    const client = this.providers.get(provider);

    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    // Ensure we have valid tokens
    let accessToken = integration.accessToken;
    if (!accessToken) {
      throw new Error('No access token available');
    }

    // Check if token needs refresh
    if (
      integration.tokenExpiresAt &&
      integration.tokenExpiresAt < new Date() &&
      integration.refreshToken
    ) {
      const newTokens = await client.refreshToken(integration.refreshToken);
      accessToken = newTokens.accessToken;

      // Update stored tokens
      await db
        .update(linkedIntegrations)
        .set({
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken ?? integration.refreshToken,
          tokenExpiresAt: newTokens.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(linkedIntegrations.id, connectionId));
    }

    const calendars = (
      (integration.metadata as { calendars?: SyncedCalendar[] }).calendars ?? []
    ).filter((c) => c.syncEnabled);

    const result: SyncResult = {
      success: true,
      eventsCreated: 0,
      eventsUpdated: 0,
      eventsDeleted: 0,
      errors: [],
      syncedAt: new Date(),
    };

    for (const calendar of calendars) {
      try {
        const syncKey = `${connectionId}:${calendar.id}`;
        const syncToken = this.syncTokens.get(syncKey);

        // Get events from external calendar
        const { events: externalEvents, nextSyncToken } = await client.getEvents(
          accessToken,
          calendar.externalId,
          {
            syncToken,
            timeMin: syncToken ? undefined : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            timeMax: syncToken ? undefined : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Next year
          },
        );

        // Store new sync token
        if (nextSyncToken) {
          this.syncTokens.set(syncKey, nextSyncToken);
        }

        // Process each event
        for (const externalEvent of externalEvents) {
          try {
            const syncResult = await this.syncEvent(
              userId,
              connectionId,
              calendar.id,
              externalEvent,
            );
            if (syncResult === 'created') result.eventsCreated++;
            if (syncResult === 'updated') result.eventsUpdated++;
          } catch (err) {
            result.errors.push({
              eventId: externalEvent.externalId,
              operation: 'update',
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
      } catch (err) {
        result.errors.push({
          operation: 'update',
          error: `Calendar ${calendar.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * Sync a single event.
   */
  private async syncEvent(
    userId: string,
    connectionId: string,
    calendarId: string,
    externalEvent: ExternalCalendarEvent,
  ): Promise<'created' | 'updated' | 'skipped'> {
    // Check if event already exists by iCalUID or external ID
    // For simplicity, we're using title + start time as a match key
    // In production, you'd want to track external IDs in a sync mapping table

    const existingEvent = await db.query.events.findFirst({
      where: and(eq(events.creatorId, userId), eq(events.title, externalEvent.title)),
    });

    const now = new Date();

    if (existingEvent) {
      // Update existing event
      await db
        .update(events)
        .set({
          description: externalEvent.description,
          startTime: externalEvent.startTime,
          endTime: externalEvent.endTime,
          isAllDay: externalEvent.isAllDay,
          location: externalEvent.location,
          recurrenceRule: externalEvent.recurrenceRule,
          updatedAt: now,
        })
        .where(eq(events.id, existingEvent.id));

      return 'updated';
    }

    // Create new event
    await db.insert(events).values({
      id: crypto.randomUUID(),
      title: externalEvent.title,
      description: externalEvent.description,
      startTime: externalEvent.startTime,
      endTime: externalEvent.endTime,
      isAllDay: externalEvent.isAllDay,
      location: externalEvent.location,
      recurrenceRule: externalEvent.recurrenceRule,
      creatorId: userId,
      createdAt: now,
      updatedAt: now,
    });

    return 'created';
  }

  /**
   * Push a local event to external calendar.
   */
  async pushEvent(connectionId: string, userId: string, eventId: string): Promise<void> {
    const [integration, event] = await Promise.all([
      db.query.linkedIntegrations.findFirst({
        where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
      }),
      db.query.events.findFirst({
        where: and(eq(events.id, eventId), eq(events.creatorId, userId)),
      }),
    ]);

    if (!integration || !event) {
      throw new Error('Connection or event not found');
    }

    const provider = this.mapIntegrationToProvider(integration.provider);
    const client = this.providers.get(provider);

    if (!client || !integration.accessToken) {
      throw new Error('Cannot push to this provider');
    }

    const calendars = (
      (integration.metadata as { calendars?: SyncedCalendar[] }).calendars ?? []
    ).filter(
      (c) => c.syncEnabled && (c.syncDirection === 'push' || c.syncDirection === 'bidirectional'),
    );

    const targetCalendar = calendars.find((c) => c.isPrimary) ?? calendars[0];

    if (!targetCalendar) {
      throw new Error('No calendar configured for push');
    }

    await client.createEvent(integration.accessToken, targetCalendar.externalId, {
      title: event.title,
      description: event.description ?? undefined,
      startTime: event.startTime,
      endTime: event.endTime ?? undefined,
      isAllDay: event.isAllDay,
      location: event.location ?? undefined,
      recurrenceRule: event.recurrenceRule ?? undefined,
      status: 'confirmed',
      visibility: 'public',
    });
  }

  private mapIntegrationToProvider(integration: string): CalendarProvider {
    switch (integration) {
      case 'google_calendar':
        return 'google';
      case 'outlook_calendar':
        return 'outlook';
      case 'apple_calendar':
        return 'icloud';
      default:
        return 'caldav';
    }
  }
}

/**
 * Create calendar sync service from environment.
 */
export function createCalendarSyncService(config?: CalendarSyncConfig): CalendarSyncService {
  // If explicit config provided, use it (for testing/DI)
  if (config) {
    return new CalendarSyncService(config);
  }

  // Build config from validated env config objects
  const envConfig: CalendarSyncConfig = {};

  if (env.googleCalendar) {
    envConfig.google = env.googleCalendar;
  }

  if (env.outlookCalendar) {
    envConfig.outlook = env.outlookCalendar;
  }

  return new CalendarSyncService(envConfig);
}

// Singleton instance
let calendarSyncServiceInstance: CalendarSyncService | null = null;

/**
 * Get the shared calendar sync service instance.
 */
export function getCalendarSyncService(): CalendarSyncService {
  calendarSyncServiceInstance ??= createCalendarSyncService();
  return calendarSyncServiceInstance;
}
