/**
 * Calendar sync service.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { events, linkedIntegrations, calendarSyncTokens } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { GoogleCalendarProvider } from './providers/google.js';
import { OutlookCalendarProvider } from './providers/outlook.js';
import { ICloudCalendarProvider } from './providers/icloud.js';
import { CalDAVProvider } from './providers/caldav.js';
import { getMappingService, type MappingService } from '../sync/mapping-service.js';
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
  private readonly mappingService: MappingService;

  constructor(config: CalendarSyncConfig) {
    this.providers = new Map();
    this.mappingService = getMappingService();

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
   * Get persisted sync token for a calendar.
   */
  private async getSyncToken(
    integrationId: string,
    calendarId: string,
  ): Promise<string | undefined> {
    const result = await db.query.calendarSyncTokens.findFirst({
      where: and(
        eq(calendarSyncTokens.integrationId, integrationId),
        eq(calendarSyncTokens.calendarId, calendarId),
      ),
    });
    return result?.syncToken;
  }

  /**
   * Persist sync token for a calendar.
   */
  private async saveSyncToken(
    integrationId: string,
    calendarId: string,
    token: string,
  ): Promise<void> {
    const id = `${integrationId}:${calendarId}`;
    const now = new Date();

    // Upsert the sync token
    const existing = await db.query.calendarSyncTokens.findFirst({
      where: eq(calendarSyncTokens.id, id),
    });

    if (existing) {
      await db
        .update(calendarSyncTokens)
        .set({
          syncToken: token,
          lastSyncAt: now,
          updatedAt: now,
        })
        .where(eq(calendarSyncTokens.id, id));
    } else {
      await db.insert(calendarSyncTokens).values({
        id,
        integrationId,
        calendarId,
        syncToken: token,
        lastSyncAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Clear sync token (e.g., when token becomes invalid).
   */
  private async clearSyncToken(integrationId: string, calendarId: string): Promise<void> {
    const id = `${integrationId}:${calendarId}`;
    await db.delete(calendarSyncTokens).where(eq(calendarSyncTokens.id, id));
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
        // Get persisted sync token for incremental sync
        const syncToken = await this.getSyncToken(connectionId, calendar.externalId);

        // Get events from external calendar
        let externalEvents: ExternalCalendarEvent[];
        let nextSyncToken: string | undefined;

        try {
          const eventsResult = await client.getEvents(accessToken, calendar.externalId, {
            syncToken,
            timeMin: syncToken ? undefined : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            timeMax: syncToken ? undefined : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Next year
          });
          externalEvents = eventsResult.events;
          nextSyncToken = eventsResult.nextSyncToken;
        } catch (err) {
          // Handle 410 Gone (sync token invalidated) by clearing token and doing full sync
          if (err instanceof Error && err.message.includes('410')) {
            await this.clearSyncToken(connectionId, calendar.externalId);
            const eventsResult = await client.getEvents(accessToken, calendar.externalId, {
              timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              timeMax: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            });
            externalEvents = eventsResult.events;
            nextSyncToken = eventsResult.nextSyncToken;
          } else {
            throw err;
          }
        }

        // Persist new sync token
        if (nextSyncToken) {
          await this.saveSyncToken(connectionId, calendar.externalId, nextSyncToken);
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
            if (syncResult === 'deleted') result.eventsDeleted++;
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
   * Sync a single event using external ID mappings.
   */
  private async syncEvent(
    userId: string,
    connectionId: string,
    calendarId: string,
    externalEvent: ExternalCalendarEvent,
  ): Promise<'created' | 'updated' | 'deleted' | 'skipped'> {
    // Handle deleted events from external calendar
    if (externalEvent.status === 'cancelled') {
      return this.handleDeletedEvent(connectionId, externalEvent.externalId);
    }

    // Look up existing mapping by external ID
    const existingMapping = await this.mappingService.findByExternalId(
      connectionId,
      externalEvent.externalId,
    );

    const now = new Date();

    if (existingMapping) {
      // Update existing event via mapping
      await db
        .update(events)
        .set({
          title: externalEvent.title,
          description: externalEvent.description,
          startTime: externalEvent.startTime,
          endTime: externalEvent.endTime,
          isAllDay: externalEvent.isAllDay,
          location: externalEvent.location,
          recurrenceRule: externalEvent.recurrenceRule,
          updatedAt: now,
        })
        .where(eq(events.id, existingMapping.localEntityId));

      // Update mapping with new etag/version
      await this.mappingService.markSyncedFromExternal(existingMapping.id, externalEvent.etag);

      return 'updated';
    }

    // Create new event and mapping
    const eventId = crypto.randomUUID();

    await db.insert(events).values({
      id: eventId,
      title: externalEvent.title,
      description: externalEvent.description,
      startTime: externalEvent.startTime,
      endTime: externalEvent.endTime,
      isAllDay: externalEvent.isAllDay,
      location: externalEvent.location,
      recurrenceRule: externalEvent.recurrenceRule,
      creatorId: userId,
      source: 'external',
      sourceIntegrationId: connectionId,
      createdAt: now,
      updatedAt: now,
    });

    // Create mapping for the new event
    await this.mappingService.createMapping({
      integrationId: connectionId,
      entityType: 'event',
      localEntityId: eventId,
      externalId: externalEvent.externalId,
      syncDirection: 'inbound',
      externalVersion: externalEvent.etag,
      metadata: {
        calendarId,
        iCalUID: externalEvent.iCalUID,
      },
    });

    return 'created';
  }

  /**
   * Handle a deleted event from external calendar.
   */
  private async handleDeletedEvent(
    integrationId: string,
    externalId: string,
  ): Promise<'deleted' | 'skipped'> {
    const mapping = await this.mappingService.findByExternalId(integrationId, externalId);

    if (!mapping) {
      // No local event to delete
      return 'skipped';
    }

    // Delete the local event
    await db.delete(events).where(eq(events.id, mapping.localEntityId));

    // Delete the mapping
    await this.mappingService.deleteMapping(mapping.id);

    return 'deleted';
  }

  /**
   * Push a local event to external calendar.
   * Creates a mapping to track the relationship.
   */
  async pushEvent(connectionId: string, userId: string, eventId: string): Promise<string> {
    // Check if mapping already exists
    const existingMapping = await this.mappingService.findByLocalEntity(
      connectionId,
      'event',
      eventId,
    );

    if (existingMapping) {
      // Already pushed, do an update instead
      await this.pushEventUpdate(connectionId, userId, eventId);
      return existingMapping.externalId;
    }

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

    // Create event in external calendar
    const createdEvent = await client.createEvent(
      integration.accessToken,
      targetCalendar.externalId,
      {
        title: event.title,
        description: event.description ?? undefined,
        startTime: event.startTime,
        endTime: event.endTime ?? undefined,
        isAllDay: event.isAllDay,
        location: event.location ?? undefined,
        recurrenceRule: event.recurrenceRule ?? undefined,
        status: 'confirmed',
        visibility: 'public',
      },
    );

    // Create mapping to track the relationship
    await this.mappingService.createMapping({
      integrationId: connectionId,
      entityType: 'event',
      localEntityId: eventId,
      externalId: createdEvent.externalId,
      syncDirection: 'outbound',
      externalVersion: createdEvent.etag,
      metadata: {
        calendarId: targetCalendar.externalId,
        iCalUID: createdEvent.iCalUID,
      },
    });

    return createdEvent.externalId;
  }

  /**
   * Push an event update to external calendar.
   */
  async pushEventUpdate(connectionId: string, userId: string, eventId: string): Promise<void> {
    // Find existing mapping
    const mapping = await this.mappingService.findByLocalEntity(connectionId, 'event', eventId);

    if (!mapping) {
      // No mapping exists - create new event instead
      await this.pushEvent(connectionId, userId, eventId);
      return;
    }

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

    const calendarId = (mapping.metadata as { calendarId: string } | null)?.calendarId;
    if (!calendarId) {
      throw new Error('Calendar ID not found in mapping');
    }

    // Update event in external calendar
    const updatedEvent = await client.updateEvent(
      integration.accessToken,
      calendarId,
      mapping.externalId,
      {
        title: event.title,
        description: event.description ?? undefined,
        startTime: event.startTime,
        endTime: event.endTime ?? undefined,
        isAllDay: event.isAllDay,
        location: event.location ?? undefined,
        recurrenceRule: event.recurrenceRule ?? undefined,
      },
    );

    // Update mapping with new etag
    await this.mappingService.markSyncedToExternal(mapping.id, updatedEvent.etag);
  }

  /**
   * Delete an event from external calendar.
   */
  async pushEventDelete(connectionId: string, userId: string, eventId: string): Promise<void> {
    // Find existing mapping
    const mapping = await this.mappingService.findByLocalEntity(connectionId, 'event', eventId);

    if (!mapping) {
      // No mapping exists - nothing to delete externally
      return;
    }

    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration?.accessToken) {
      throw new Error('Connection not found or no access token');
    }

    const provider = this.mapIntegrationToProvider(integration.provider);
    const client = this.providers.get(provider);

    if (!client) {
      throw new Error('Provider not configured');
    }

    const calendarId = (mapping.metadata as { calendarId: string } | null)?.calendarId;
    if (!calendarId) {
      throw new Error('Calendar ID not found in mapping');
    }

    // Delete event from external calendar
    await client.deleteEvent(integration.accessToken, calendarId, mapping.externalId);

    // Delete the mapping
    await this.mappingService.deleteMapping(mapping.id);
  }

  /**
   * Push event to all bidirectional connections for a user.
   * Used when a local event is created/updated.
   */
  async pushEventToAllConnections(
    userId: string,
    eventId: string,
    operation: 'create' | 'update' | 'delete',
  ): Promise<void> {
    const connections = await this.getConnections(userId);

    const bidirectionalConnections = connections.filter((c) =>
      c.calendars.some((cal) => cal.syncEnabled && cal.syncDirection === 'bidirectional'),
    );

    for (const connection of bidirectionalConnections) {
      try {
        switch (operation) {
          case 'create':
            await this.pushEvent(connection.id, userId, eventId);
            break;
          case 'update':
            await this.pushEventUpdate(connection.id, userId, eventId);
            break;
          case 'delete':
            await this.pushEventDelete(connection.id, userId, eventId);
            break;
        }
      } catch (error) {
        // Log error but don't fail - push is best-effort
        console.error(
          `Failed to push ${operation} to ${connection.provider}:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    }
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
