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
    },
  ): Promise<{
    events: ExternalCalendarEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
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
