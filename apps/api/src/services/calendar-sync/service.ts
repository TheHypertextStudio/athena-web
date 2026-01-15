/**
 * Calendar sync service.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  events,
  linkedIntegrations,
  calendarSyncTokens,
  externalIdMappings,
} from '../../db/schema/index.js';
import { eq, and, inArray, gte, lte } from 'drizzle-orm';
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
  AccountSettingsUpdate,
} from './types.js';
import { env } from '../../lib/env.js';
import { decryptSecretOptional, encryptSecret } from '../../lib/crypto.js';

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

interface IntegrationSyncStatus {
  lastSyncAt?: string | null;
  lastSyncStatus?: 'success' | 'error' | null;
  lastSyncError?: string | null;
}

interface IntegrationMetadata {
  calendars: SyncedCalendar[];
  syncStatus?: IntegrationSyncStatus;
  webhookWatch?: {
    id: string;
    resourceId?: string;
    expiresAt: string;
    calendarId: string;
  };
}

const CALENDAR_SYNC_DIRECTIONS = ['pull', 'push', 'bidirectional'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const coerceSyncedCalendar = (value: unknown): SyncedCalendar | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : undefined;
  const externalId = typeof value.externalId === 'string' ? value.externalId : undefined;
  const name = typeof value.name === 'string' ? value.name : undefined;

  if (!id || !externalId || !name) {
    return null;
  }

  const color = typeof value.color === 'string' ? value.color : undefined;
  const canEdit = typeof value.canEdit === 'boolean' ? value.canEdit : undefined;
  const isPrimary = typeof value.isPrimary === 'boolean' ? value.isPrimary : false;
  const syncEnabled = typeof value.syncEnabled === 'boolean' ? value.syncEnabled : true;

  const rawDirection =
    typeof value.syncDirection === 'string'
      ? (value.syncDirection as (typeof CALENDAR_SYNC_DIRECTIONS)[number])
      : undefined;
  const parsedDirection =
    rawDirection && CALENDAR_SYNC_DIRECTIONS.includes(rawDirection) ? rawDirection : undefined;
  const syncDirection = parsedDirection ?? (canEdit === false ? 'pull' : 'bidirectional');

  return {
    id,
    externalId,
    name,
    color,
    isPrimary,
    canEdit,
    syncEnabled,
    syncDirection,
  };
};

const parseSyncStatus = (value: unknown): IntegrationSyncStatus | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const lastSyncAt = typeof value.lastSyncAt === 'string' ? value.lastSyncAt : undefined;
  const lastSyncStatus =
    value.lastSyncStatus === 'success' || value.lastSyncStatus === 'error'
      ? value.lastSyncStatus
      : undefined;
  const lastSyncError =
    value.lastSyncError === null || typeof value.lastSyncError === 'string'
      ? value.lastSyncError
      : undefined;

  if (!lastSyncAt && !lastSyncStatus && lastSyncError === undefined) {
    return undefined;
  }

  return {
    lastSyncAt,
    lastSyncStatus,
    lastSyncError,
  };
};

const webhookWatchSchema = z.object({
  id: z.string(),
  resourceId: z.string().optional(),
  expiresAt: z.string(),
  calendarId: z.string(),
});

const parseWebhookWatch = (
  value: unknown,
): { id: string; resourceId?: string; expiresAt: string; calendarId: string } | undefined => {
  const result = webhookWatchSchema.safeParse(value);
  return result.success ? result.data : undefined;
};

const parseIntegrationMetadata = (metadata: unknown): IntegrationMetadata => {
  if (!isRecord(metadata)) {
    return { calendars: [] };
  }

  const calendars = Array.isArray(metadata.calendars)
    ? metadata.calendars
        .map(coerceSyncedCalendar)
        .filter((calendar): calendar is SyncedCalendar => calendar !== null)
    : [];
  const syncStatus = parseSyncStatus(metadata.syncStatus);

  // Parse webhook watch if present
  const webhookWatch = parseWebhookWatch(metadata.webhookWatch);

  return {
    calendars,
    syncStatus,
    webhookWatch,
  };
};

const getCalendarIdFromMetadata = (
  metadata: Record<string, unknown> | null,
): string | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  return typeof metadata.calendarId === 'string' ? metadata.calendarId : undefined;
};

const isInvalidSyncTokenError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const status =
    (error as { response?: { status?: number } }).response?.status ??
    (error as { code?: number }).code ??
    (error as { statusCode?: number }).statusCode;

  return status === 410;
};

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
  getAuthUrl(provider: CalendarProvider, state: string): string {
    const client = this.providers.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    return client.getAuthUrl(state);
  }

  /**
   * Handle OAuth callback and create connection.
   * Supports multiple accounts per provider.
   */
  async handleOAuthCallback(
    provider: CalendarProvider,
    userId: string,
    code: string,
  ): Promise<CalendarConnection> {
    const client = this.providers.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    // Exchange code for tokens
    const tokens = await client.exchangeCode(code);
    const encryptedAccessToken = encryptSecret(tokens.accessToken);
    const encryptedRefreshToken = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;

    // Get list of calendars
    const calendars = await client.listCalendars(tokens.accessToken);

    // Get account email if provider supports it
    const accountEmail = client.getUserEmail
      ? await client.getUserEmail(tokens.accessToken)
      : undefined;

    // Store connection
    const now = new Date();

    // Map provider to integration provider enum
    const providerMap: Record<CalendarProvider, string> = {
      google: 'google_calendar',
      outlook: 'outlook_calendar',
      icloud: 'apple_calendar',
      caldav: 'caldav_calendar',
    };

    const integrationProvider = providerMap[provider] as
      | 'google_calendar'
      | 'outlook_calendar'
      | 'apple_calendar'
      | 'caldav_calendar';

    // Use the primary calendar's external ID as account identifier, or email, or 'default'
    const externalAccountId =
      accountEmail ?? calendars.find((c) => c.isPrimary)?.externalId ?? 'default';

    // Check if this specific external account is already connected (not just any account for this provider)
    const existingByExternalAccount = await db.query.linkedIntegrations.findFirst({
      where: and(
        eq(linkedIntegrations.userId, userId),
        eq(linkedIntegrations.provider, integrationProvider),
        eq(linkedIntegrations.externalAccountId, externalAccountId),
      ),
    });

    if (existingByExternalAccount) {
      // Update existing connection for this specific account
      const existingMetadata = parseIntegrationMetadata(existingByExternalAccount.metadata);
      const mergedCalendars = this.mergeCalendars(existingMetadata.calendars, calendars);
      const metadata = {
        ...existingMetadata,
        calendars: mergedCalendars,
      };

      await db
        .update(linkedIntegrations)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scope,
          accountEmail,
          metadata,
          updatedAt: now,
        })
        .where(eq(linkedIntegrations.id, existingByExternalAccount.id));

      return {
        id: existingByExternalAccount.id,
        userId,
        provider,
        externalAccountId,
        tokenExpiresAt: tokens.expiresAt,
        syncEnabled: true,
        calendars: mergedCalendars,
        accountLabel: existingByExternalAccount.accountLabel ?? undefined,
        accountEmail,
        accountColor: existingByExternalAccount.accountColor ?? undefined,
        isPrimary: existingByExternalAccount.isPrimary,
        displayOrder: existingByExternalAccount.displayOrder,
        createdAt: existingByExternalAccount.createdAt,
        updatedAt: now,
      };
    }

    // Check if any accounts exist for this provider (to determine isPrimary)
    const existingForProvider = await db.query.linkedIntegrations.findMany({
      where: and(
        eq(linkedIntegrations.userId, userId),
        eq(linkedIntegrations.provider, integrationProvider),
      ),
    });

    // First account for this provider is primary
    const isPrimary = existingForProvider.length === 0;

    // Calculate display order (max + 1)
    const maxDisplayOrder = existingForProvider.reduce(
      (max, conn) => Math.max(max, conn.displayOrder),
      -1,
    );
    const displayOrder = maxDisplayOrder + 1;

    // Generate a default account color based on display order
    const defaultColors = ['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#9C27B0'];
    const accountColor = defaultColors[displayOrder % defaultColors.length];

    const metadata = {
      calendars,
    };

    const connectionId = crypto.randomUUID();

    await db.insert(linkedIntegrations).values({
      id: connectionId,
      userId,
      provider: integrationProvider,
      externalAccountId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scope,
      accountEmail,
      accountColor,
      isPrimary,
      displayOrder,
      metadata,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: connectionId,
      userId,
      provider,
      externalAccountId,
      tokenExpiresAt: tokens.expiresAt,
      syncEnabled: true,
      calendars,
      accountEmail,
      accountColor,
      isPrimary,
      displayOrder,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Set up a webhook watch for real-time calendar notifications.
   * This should be called after OAuth callback to enable push notifications.
   *
   * @param connectionId - Connection ID
   * @param userId - User ID
   * @returns true if watch was set up, false if provider doesn't support webhooks
   */
  async setupWebhookWatch(connectionId: string, userId: string): Promise<boolean> {
    // Get API public URL from env
    const apiPublicUrl = env.API_PUBLIC_URL;
    if (!apiPublicUrl) {
      console.warn('API_PUBLIC_URL not set, skipping webhook watch setup');
      return false;
    }

    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      throw new Error('Connection not found');
    }

    const provider = this.mapIntegrationToProvider(integration.provider);
    const client = this.providers.get(provider);

    if (!client?.createWatch) {
      // Provider doesn't support webhooks (e.g., iCloud, CalDAV)
      return false;
    }

    const accessToken = decryptSecretOptional(integration.accessToken);
    if (!accessToken) {
      throw new Error('No access token available');
    }

    // Determine webhook URL based on provider
    const webhookPath =
      provider === 'google' ? '/webhooks/google-calendar' : '/webhooks/outlook-calendar';
    const webhookUrl = `${apiPublicUrl}${webhookPath}`;

    // Channel token identifies the connection: userId:connectionId
    const channelToken = `${userId}:${connectionId}`;

    // Watch the primary calendar (or 'primary' for Google which means the main calendar)
    const calendarId = 'primary';

    try {
      const watch = await client.createWatch(accessToken, calendarId, webhookUrl, channelToken);

      // Store watch metadata in connection
      const existingMetadata = parseIntegrationMetadata(integration.metadata);
      const updatedMetadata = {
        ...existingMetadata,
        webhookWatch: {
          id: watch.id,
          resourceId: watch.resourceId,
          expiresAt: watch.expiresAt.toISOString(),
          calendarId: watch.calendarId,
        },
      };

      await db
        .update(linkedIntegrations)
        .set({
          metadata: updatedMetadata,
          updatedAt: new Date(),
        })
        .where(eq(linkedIntegrations.id, connectionId));

      console.log(
        `Webhook watch created for ${provider} connection ${connectionId}, expires ${watch.expiresAt.toISOString()}`,
      );
      return true;
    } catch (error) {
      console.error(`Failed to create webhook watch for ${provider}:`, error);
      // Don't throw - webhook setup failure shouldn't break the connection
      return false;
    }
  }

  /**
   * Renew a webhook watch, stopping the old one first to prevent duplicates.
   * Called when OAuth tokens are refreshed.
   *
   * @param connectionId - Connection ID
   * @param userId - User ID
   * @param accessToken - Fresh access token
   */
  private async renewWebhookWatch(
    connectionId: string,
    userId: string,
    accessToken: string,
  ): Promise<boolean> {
    const apiPublicUrl = env.API_PUBLIC_URL;
    if (!apiPublicUrl) {
      return false;
    }

    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      return false;
    }

    const provider = this.mapIntegrationToProvider(integration.provider);
    const client = this.providers.get(provider);

    if (!client?.createWatch) {
      return false;
    }

    const metadata = parseIntegrationMetadata(integration.metadata);

    // Stop existing watch first to prevent duplicates
    if (metadata.webhookWatch && client.stopWatch) {
      try {
        await client.stopWatch(accessToken, {
          id: metadata.webhookWatch.id,
          resourceId: metadata.webhookWatch.resourceId,
          expiresAt: new Date(metadata.webhookWatch.expiresAt),
          calendarId: metadata.webhookWatch.calendarId,
        });
      } catch {
        // Ignore errors stopping old watch - it may have already expired
      }
    }

    // Create new watch
    const webhookPath =
      provider === 'google' ? '/webhooks/google-calendar' : '/webhooks/outlook-calendar';
    const webhookUrl = `${apiPublicUrl}${webhookPath}`;
    const channelToken = `${userId}:${connectionId}`;

    try {
      const watch = await client.createWatch(accessToken, 'primary', webhookUrl, channelToken);

      // Update metadata with new watch
      const updatedMetadata = {
        ...metadata,
        webhookWatch: {
          id: watch.id,
          resourceId: watch.resourceId,
          expiresAt: watch.expiresAt.toISOString(),
          calendarId: watch.calendarId,
        },
      };

      await db
        .update(linkedIntegrations)
        .set({
          metadata: updatedMetadata,
          updatedAt: new Date(),
        })
        .where(eq(linkedIntegrations.id, connectionId));

      console.log(
        `Webhook watch renewed for ${provider} connection ${connectionId}, expires ${watch.expiresAt.toISOString()}`,
      );
      return true;
    } catch (error) {
      console.error(`Failed to renew webhook watch for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Get user's calendar connections.
   * Returns all connections, supporting multiple accounts per provider.
   */
  async getConnections(userId: string): Promise<CalendarConnection[]> {
    const integrations = await db.query.linkedIntegrations.findMany({
      where: eq(linkedIntegrations.userId, userId),
    });

    return integrations
      .filter((i) =>
        ['google_calendar', 'outlook_calendar', 'apple_calendar', 'caldav_calendar'].includes(
          i.provider,
        ),
      )
      .map((i) => {
        const metadata = parseIntegrationMetadata(i.metadata);
        const syncStatus = metadata.syncStatus;
        return {
          id: i.id,
          userId: i.userId,
          provider: this.mapIntegrationToProvider(i.provider),
          externalAccountId: i.externalAccountId,
          accessToken: undefined,
          refreshToken: undefined,
          tokenExpiresAt: i.tokenExpiresAt ?? undefined,
          syncEnabled: true,
          lastSyncAt: syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt) : undefined,
          lastSyncStatus:
            (syncStatus?.lastSyncStatus as 'success' | 'error' | undefined) ?? undefined,
          lastSyncError: syncStatus?.lastSyncError ?? undefined,
          calendars: metadata.calendars,
          accountLabel: i.accountLabel ?? undefined,
          accountEmail: i.accountEmail ?? undefined,
          accountColor: i.accountColor ?? undefined,
          isPrimary: i.isPrimary,
          displayOrder: i.displayOrder,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        };
      })
      .sort((a, b) => {
        // Sort by provider, then by displayOrder
        if (a.provider !== b.provider) {
          return a.provider.localeCompare(b.provider);
        }
        return a.displayOrder - b.displayOrder;
      });
  }

  /**
   * Update account settings (label, color, primary status).
   */
  async updateAccountSettings(
    connectionId: string,
    userId: string,
    settings: AccountSettingsUpdate,
  ): Promise<void> {
    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      throw new Error('Connection not found');
    }

    const updates: Partial<typeof linkedIntegrations.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (settings.accountLabel !== undefined) {
      updates.accountLabel = settings.accountLabel;
    }

    if (settings.accountColor !== undefined) {
      updates.accountColor = settings.accountColor;
    }

    if (settings.displayOrder !== undefined) {
      updates.displayOrder = settings.displayOrder;
    }

    // If setting as primary, unset other accounts for this provider
    if (settings.isPrimary === true) {
      await db
        .update(linkedIntegrations)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(linkedIntegrations.userId, userId),
            eq(linkedIntegrations.provider, integration.provider),
          ),
        );
      updates.isPrimary = true;
    }

    await db.update(linkedIntegrations).set(updates).where(eq(linkedIntegrations.id, connectionId));
  }

  /**
   * Reorder accounts by updating displayOrder.
   */
  async reorderAccounts(userId: string, connectionIds: string[]): Promise<void> {
    const now = new Date();

    for (let i = 0; i < connectionIds.length; i++) {
      const connectionId = connectionIds[i];
      if (!connectionId) continue;

      await db
        .update(linkedIntegrations)
        .set({ displayOrder: i, updatedAt: now })
        .where(and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)));
    }
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

    const metadata = parseIntegrationMetadata(integration.metadata);
    const existingCalendars = metadata.calendars;

    const updatedCalendars = existingCalendars.map((cal) => {
      const update = calendars.find((c) => c.id === cal.id);
      if (update) {
        const nextDirection =
          cal.canEdit === false && update.syncDirection !== 'pull' ? 'pull' : update.syncDirection;
        return { ...cal, syncEnabled: update.syncEnabled, syncDirection: nextDirection };
      }
      return cal;
    });

    await db
      .update(linkedIntegrations)
      .set({
        metadata: { ...metadata, calendars: updatedCalendars },
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
    let accessToken = decryptSecretOptional(integration.accessToken);
    if (!accessToken) {
      throw new Error('No access token available');
    }

    // Check if token needs refresh
    const refreshToken = decryptSecretOptional(integration.refreshToken);
    if (integration.tokenExpiresAt && integration.tokenExpiresAt < new Date() && refreshToken) {
      const newTokens = await client.refreshToken(refreshToken);
      accessToken = newTokens.accessToken;

      // Update stored tokens
      await db
        .update(linkedIntegrations)
        .set({
          accessToken: encryptSecret(newTokens.accessToken),
          refreshToken: newTokens.refreshToken
            ? encryptSecret(newTokens.refreshToken)
            : integration.refreshToken,
          tokenExpiresAt: newTokens.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(linkedIntegrations.id, connectionId));

      // Renew webhook watch on token refresh (fire-and-forget)
      this.renewWebhookWatch(connectionId, userId, accessToken).catch((err: unknown) => {
        console.error('Failed to renew webhook watch on token refresh:', err);
      });
    }

    const metadata = parseIntegrationMetadata(integration.metadata);

    const calendars = metadata.calendars.filter((c) => c.syncEnabled && c.syncDirection !== 'push');

    const result: SyncResult = {
      success: true,
      eventsCreated: 0,
      eventsUpdated: 0,
      eventsDeleted: 0,
      errors: [],
      syncedAt: new Date(),
    };

    const supportsDeletionSync = provider === 'google' || provider === 'outlook';

    for (const calendar of calendars) {
      try {
        const syncToken = await this.getSyncToken(connectionId, calendar.externalId);
        // Google uses singleEvents: true which is incompatible with syncToken,
        // so always use time-range based fetching for Google
        const useSyncToken = syncToken && provider !== 'google';
        const timeMin = useSyncToken ? undefined : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const timeMax = useSyncToken ? undefined : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

        const fetchEvents = async (activeSyncToken?: string) => {
          const externalEvents: ExternalCalendarEvent[] = [];
          let nextSyncToken: string | undefined;
          let nextPageToken: string | undefined;
          let fullSync = !activeSyncToken;

          do {
            const eventsResult = await client.getEvents(accessToken, calendar.externalId, {
              syncToken: activeSyncToken,
              timeMin,
              timeMax,
              pageToken: nextPageToken,
            });
            externalEvents.push(...eventsResult.events);
            if (eventsResult.nextSyncToken) {
              nextSyncToken = eventsResult.nextSyncToken;
            }
            if (eventsResult.fullSync !== undefined) {
              fullSync = eventsResult.fullSync;
            }
            nextPageToken = eventsResult.nextPageToken;
          } while (nextPageToken);

          return { externalEvents, nextSyncToken, fullSync };
        };

        let externalEvents: ExternalCalendarEvent[] = [];
        let nextSyncToken: string | undefined;
        let fullSync = false;

        try {
          const eventsResult = await fetchEvents(useSyncToken ? syncToken : undefined);
          externalEvents = eventsResult.externalEvents;
          nextSyncToken = eventsResult.nextSyncToken;
          fullSync = eventsResult.fullSync;
        } catch (err) {
          if (isInvalidSyncTokenError(err)) {
            await this.clearSyncToken(connectionId, calendar.externalId);
            const eventsResult = await fetchEvents(undefined);
            externalEvents = eventsResult.externalEvents;
            nextSyncToken = eventsResult.nextSyncToken;
            fullSync = eventsResult.fullSync;
          } else {
            throw err;
          }
        }

        if (nextSyncToken) {
          await this.saveSyncToken(connectionId, calendar.externalId, nextSyncToken);
        }

        for (const externalEvent of externalEvents) {
          try {
            const syncResult = await this.syncEvent(
              userId,
              connectionId,
              calendar.externalId,
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

        if (!supportsDeletionSync && fullSync) {
          const deletedCount = await this.pruneMissingEvents(
            userId,
            connectionId,
            calendar.externalId,
            externalEvents.map((event) => event.externalId),
            { timeMin, timeMax },
          );
          result.eventsDeleted += deletedCount;
        }
      } catch (err) {
        result.errors.push({
          operation: 'update',
          error: `Calendar ${calendar.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    }

    result.success = result.errors.length === 0;

    await db
      .update(linkedIntegrations)
      .set({
        metadata: {
          ...metadata,
          syncStatus: {
            lastSyncAt: result.syncedAt.toISOString(),
            lastSyncStatus: result.success ? 'success' : 'error',
            lastSyncError: result.success ? null : (result.errors[0]?.error ?? 'Unknown error'),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(linkedIntegrations.id, connectionId));

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

    const accessToken = decryptSecretOptional(integration.accessToken);
    if (!client || !accessToken) {
      throw new Error('Cannot push to this provider');
    }

    const metadata = parseIntegrationMetadata(integration.metadata);
    const calendars = metadata.calendars.filter(
      (c) => c.syncEnabled && (c.syncDirection === 'push' || c.syncDirection === 'bidirectional'),
    );

    const targetCalendar = calendars.find((c) => c.isPrimary) ?? calendars[0];

    if (!targetCalendar) {
      throw new Error('No calendar configured for push');
    }

    // Create event in external calendar
    const createdEvent = await client.createEvent(accessToken, targetCalendar.externalId, {
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
   * Implements conflict detection with external-wins policy.
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

    const accessToken = decryptSecretOptional(integration.accessToken);
    if (!client || !accessToken) {
      throw new Error('Cannot push to this provider');
    }

    const calendarId = getCalendarIdFromMetadata(mapping.metadata);
    if (!calendarId) {
      throw new Error('Calendar ID not found in mapping');
    }

    // Conflict detection: Check if external event was modified since last sync
    // by comparing stored ETag with current external ETag
    if (mapping.externalVersion) {
      const conflictResult = await this.checkForConflict(
        client,
        accessToken,
        calendarId,
        mapping.externalId,
        mapping.externalVersion,
      );

      if (conflictResult.hasConflict && conflictResult.externalEvent) {
        // External wins - sync from external and skip push
        console.log(
          `Conflict detected for event ${eventId}: external ETag changed. ` +
            `Expected ${mapping.externalVersion}, got ${conflictResult.externalEvent.etag ?? 'unknown'}. ` +
            'Applying external-wins policy.',
        );
        await this.syncEventFromExternal(
          conflictResult.externalEvent,
          connectionId,
          userId,
          calendarId,
        );
        return;
      }
    }

    // No conflict - proceed with update
    const updatedEvent = await client.updateEvent(accessToken, calendarId, mapping.externalId, {
      title: event.title,
      description: event.description ?? undefined,
      startTime: event.startTime,
      endTime: event.endTime ?? undefined,
      isAllDay: event.isAllDay,
      location: event.location ?? undefined,
      recurrenceRule: event.recurrenceRule ?? undefined,
    });

    // Update mapping with new etag
    await this.mappingService.markSyncedToExternal(mapping.id, updatedEvent.etag);
  }

  /**
   * Check for conflict by comparing stored ETag with current external ETag.
   */
  private async checkForConflict(
    client: CalendarProviderClient,
    accessToken: string,
    calendarId: string,
    externalId: string,
    storedEtag: string,
  ): Promise<{ hasConflict: boolean; externalEvent?: ExternalCalendarEvent }> {
    try {
      // Fetch recent events - we need to find the specific event
      // Most providers support filtering, but we may need to fetch a batch
      const result = await client.getEvents(accessToken, calendarId, {
        maxResults: 250, // Fetch a reasonable batch to find our event
      });

      // Find the specific event by external ID
      const externalEvent = result.events.find((e) => e.externalId === externalId);

      if (!externalEvent) {
        // Event was deleted externally - this is a conflict (external wins = deleted)
        return { hasConflict: true };
      }

      // Compare ETags - if different, there's a conflict
      if (externalEvent.etag && externalEvent.etag !== storedEtag) {
        return { hasConflict: true, externalEvent };
      }

      // No conflict
      return { hasConflict: false };
    } catch (error) {
      // If we can't check for conflict, proceed with update (optimistic)
      console.warn(
        'Could not check for conflict, proceeding with update:',
        error instanceof Error ? error.message : 'Unknown error',
      );
      return { hasConflict: false };
    }
  }

  /**
   * Sync a single event from external source to local database.
   * Used when external wins in a conflict scenario.
   */
  private async syncEventFromExternal(
    externalEvent: ExternalCalendarEvent,
    connectionId: string,
    userId: string,
    calendarId: string,
  ): Promise<void> {
    // Find existing mapping
    const mapping = await this.mappingService.findByExternalId(
      connectionId,
      externalEvent.externalId,
    );

    if (!mapping) {
      // Create new local event from external
      await this.createLocalEventFromExternal(externalEvent, connectionId, userId, calendarId);
      return;
    }

    // Update existing local event
    await db
      .update(events)
      .set({
        title: externalEvent.title,
        description: externalEvent.description ?? null,
        startTime: externalEvent.startTime,
        endTime: externalEvent.endTime ?? null,
        isAllDay: externalEvent.isAllDay,
        location: externalEvent.location ?? null,
        recurrenceRule: externalEvent.recurrenceRule ?? null,
        updatedAt: new Date(),
      })
      .where(eq(events.id, mapping.localEntityId));

    // Update mapping with new ETag
    await this.mappingService.markSyncedFromExternal(mapping.id, externalEvent.etag);
  }

  /**
   * Create a local event from an external event.
   * Used when external wins in a conflict scenario and no local event exists.
   */
  private async createLocalEventFromExternal(
    externalEvent: ExternalCalendarEvent,
    connectionId: string,
    userId: string,
    calendarId: string,
  ): Promise<void> {
    const eventId = crypto.randomUUID();
    const now = new Date();

    await db.insert(events).values({
      id: eventId,
      title: externalEvent.title,
      description: externalEvent.description ?? null,
      startTime: externalEvent.startTime,
      endTime: externalEvent.endTime ?? null,
      isAllDay: externalEvent.isAllDay,
      location: externalEvent.location ?? null,
      recurrenceRule: externalEvent.recurrenceRule ?? null,
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

    if (!integration) {
      throw new Error('Connection not found');
    }

    const accessToken = decryptSecretOptional(integration.accessToken ?? null);
    if (!accessToken) {
      throw new Error('Connection not found or no access token');
    }

    const provider = this.mapIntegrationToProvider(integration.provider);
    const client = this.providers.get(provider);

    if (!client) {
      throw new Error('Provider not configured');
    }

    const calendarId = getCalendarIdFromMetadata(mapping.metadata);
    if (!calendarId) {
      throw new Error('Calendar ID not found in mapping');
    }

    // Delete event from external calendar
    await client.deleteEvent(accessToken, calendarId, mapping.externalId);

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
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.creatorId, userId)),
    });

    if (!event) {
      return;
    }

    if (event.sourceIntegrationId) {
      if (operation === 'create') {
        return;
      }

      const integration = await db.query.linkedIntegrations.findFirst({
        where: and(
          eq(linkedIntegrations.id, event.sourceIntegrationId),
          eq(linkedIntegrations.userId, userId),
        ),
      });

      if (!integration) {
        return;
      }

      const mapping = await this.mappingService.findByLocalEntity(
        event.sourceIntegrationId,
        'event',
        eventId,
      );
      const calendarId = mapping ? getCalendarIdFromMetadata(mapping.metadata) : undefined;
      const metadata = parseIntegrationMetadata(integration.metadata);
      const calendar = calendarId
        ? metadata.calendars.find((cal) => cal.externalId === calendarId || cal.id === calendarId)
        : undefined;

      if (!calendar || !calendar.syncEnabled || calendar.syncDirection === 'pull') {
        return;
      }

      try {
        switch (operation) {
          case 'update':
            await this.pushEventUpdate(event.sourceIntegrationId, userId, eventId);
            break;
          case 'delete':
            await this.pushEventDelete(event.sourceIntegrationId, userId, eventId);
            break;
        }
      } catch (error) {
        console.error(
          `Failed to push ${operation} to source integration:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }

      return;
    }

    const connections = await this.getConnections(userId);
    const pushConnections = connections.filter((c) =>
      c.calendars.some(
        (cal) =>
          cal.syncEnabled &&
          (cal.syncDirection === 'push' || cal.syncDirection === 'bidirectional'),
      ),
    );

    for (const connection of pushConnections) {
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
      case 'caldav_calendar':
        return 'caldav';
      default:
        return 'caldav';
    }
  }

  private mergeCalendars(existing: SyncedCalendar[], incoming: SyncedCalendar[]): SyncedCalendar[] {
    const existingByExternalId = new Map(
      existing.map((calendar) => [calendar.externalId, calendar]),
    );
    const existingById = new Map(existing.map((calendar) => [calendar.id, calendar]));

    return incoming.map((calendar) => {
      const previous =
        existingByExternalId.get(calendar.externalId) ?? existingById.get(calendar.id);
      const canEdit = calendar.canEdit ?? previous?.canEdit ?? true;
      const syncEnabled = previous?.syncEnabled ?? calendar.syncEnabled;
      const desiredDirection = previous?.syncDirection ?? calendar.syncDirection;
      const syncDirection = !canEdit && desiredDirection !== 'pull' ? 'pull' : desiredDirection;

      return {
        ...calendar,
        externalId: calendar.externalId,
        canEdit,
        syncEnabled,
        syncDirection,
      };
    });
  }

  private async pruneMissingEvents(
    userId: string,
    connectionId: string,
    calendarExternalId: string,
    externalEventIds: string[],
    options?: { timeMin?: Date; timeMax?: Date },
  ): Promise<number> {
    const defaultTimeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const defaultTimeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const timeMin = options?.timeMin ?? defaultTimeMin;
    const timeMax = options?.timeMax ?? defaultTimeMax;
    const eventIdSet = new Set(externalEventIds.filter(Boolean));
    const mappings = await this.mappingService.getMappingsForIntegration(connectionId);

    const missingMappings = mappings.filter((mapping) => {
      if (mapping.entityType !== 'event') {
        return false;
      }
      const calendarId = getCalendarIdFromMetadata(mapping.metadata);
      return calendarId === calendarExternalId && !eventIdSet.has(mapping.externalId);
    });

    if (missingMappings.length === 0) {
      return 0;
    }

    const missingEventIds = missingMappings.map((mapping) => mapping.localEntityId);
    const conditions = [
      eq(events.creatorId, userId),
      eq(events.sourceIntegrationId, connectionId),
      inArray(events.id, missingEventIds),
      gte(events.startTime, timeMin),
      lte(events.startTime, timeMax),
    ];

    const eventsToDelete = await db.query.events.findMany({
      where: and(...conditions),
      columns: { id: true },
    });

    if (eventsToDelete.length === 0) {
      return 0;
    }

    const deletableIds = eventsToDelete.map((event) => event.id);
    const mappingIdsToDelete = missingMappings
      .filter((mapping) => deletableIds.includes(mapping.localEntityId))
      .map((mapping) => mapping.id);

    await db.delete(events).where(inArray(events.id, deletableIds));

    if (mappingIdsToDelete.length > 0) {
      await db.delete(externalIdMappings).where(inArray(externalIdMappings.id, mappingIdsToDelete));
    }

    return eventsToDelete.length;
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
