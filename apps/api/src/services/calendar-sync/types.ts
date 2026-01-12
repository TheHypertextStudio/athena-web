/**
 * Calendar sync types.
 *
 * @packageDocumentation
 */

/**
 * Supported calendar providers.
 */
export type CalendarProvider = 'google' | 'outlook' | 'icloud' | 'caldav';

/**
 * Calendar connection configuration.
 *
 * Supports multiple accounts per provider (e.g., work + personal Google accounts).
 */
export interface CalendarConnection {
  id: string;
  userId: string;
  provider: CalendarProvider;
  externalAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  syncEnabled: boolean;
  lastSyncAt?: Date;
  lastSyncStatus?: 'success' | 'error';
  lastSyncError?: string;
  calendars: SyncedCalendar[];
  /** User-defined label for this account (e.g., "Work", "Personal") */
  accountLabel?: string;
  /** Email address from OAuth profile for display */
  accountEmail?: string;
  /** Color for account indicator in calendar view (hex code) */
  accountColor?: string;
  /** Whether this is the primary account for the provider (used for event creation default) */
  isPrimary: boolean;
  /** Display order for account list UI (0 = first) */
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A calendar that is synced.
 */
export interface SyncedCalendar {
  id: string;
  externalId: string;
  name: string;
  color?: string;
  isPrimary: boolean;
  canEdit?: boolean;
  syncEnabled: boolean;
  syncDirection: 'pull' | 'push' | 'bidirectional';
}

/**
 * External calendar event.
 */
export interface ExternalCalendarEvent {
  externalId: string;
  calendarId: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  isAllDay: boolean;
  location?: string;
  recurrenceRule?: string;
  attendees?: EventAttendee[];
  status: 'confirmed' | 'tentative' | 'cancelled';
  visibility: 'public' | 'private' | 'confidential';
  etag?: string;
  iCalUID?: string;
}

/**
 * Event attendee.
 */
export interface EventAttendee {
  email: string;
  name?: string;
  status: 'pending' | 'accepted' | 'declined' | 'tentative';
  isOrganizer: boolean;
}

/**
 * Sync result.
 */
export interface SyncResult {
  success: boolean;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  errors: SyncError[];
  syncedAt: Date;
  nextSyncToken?: string;
}

/**
 * Sync error.
 */
export interface SyncError {
  eventId?: string;
  operation: 'create' | 'update' | 'delete';
  error: string;
}

/**
 * OAuth configuration.
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * OAuth tokens.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType: string;
  scope?: string;
}

/**
 * CalDAV configuration.
 */
export interface CalDAVConfig {
  serverUrl: string;
  username: string;
  password: string;
}

/**
 * Account settings update.
 */
export interface AccountSettingsUpdate {
  accountLabel?: string;
  accountColor?: string;
  isPrimary?: boolean;
  displayOrder?: number;
}

/**
 * Calendar provider interface.
 */
export interface CalendarProviderClient {
  /**
   * Provider identifier.
   */
  provider: CalendarProvider;

  /**
   * Get OAuth authorization URL.
   */
  getAuthUrl(state: string): string;

  /**
   * Exchange authorization code for tokens.
   */
  exchangeCode(code: string): Promise<OAuthTokens>;

  /**
   * Get user profile info (email) from access token.
   * Optional - not all providers support this.
   */
  getUserEmail?(accessToken: string): Promise<string | undefined>;

  /**
   * Refresh access token.
   */
  refreshToken(refreshToken: string): Promise<OAuthTokens>;

  /**
   * List available calendars.
   */
  listCalendars(accessToken: string): Promise<SyncedCalendar[]>;

  /**
   * Get events from a calendar.
   */
  getEvents(
    accessToken: string,
    calendarId: string,
    options?: {
      timeMin?: Date;
      timeMax?: Date;
      syncToken?: string;
      maxResults?: number;
      pageToken?: string;
    },
  ): Promise<{
    events: ExternalCalendarEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
    fullSync?: boolean;
  }>;

  /**
   * Create an event.
   */
  createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent>;

  /**
   * Update an event.
   */
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent>;

  /**
   * Delete an event.
   */
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}
