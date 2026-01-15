/**
 * Mock implementations for calendar sync testing.
 *
 * @packageDocumentation
 */

// =============================================================================
// Types (self-contained for test-utils package isolation)
// =============================================================================

export type CalendarProvider = 'google' | 'outlook' | 'icloud' | 'caldav';

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

export interface EventAttendee {
  email: string;
  name?: string;
  status: 'pending' | 'accepted' | 'declined' | 'tentative';
  isOrganizer: boolean;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType: string;
  scope?: string;
}

export interface CalendarProviderClient {
  provider: CalendarProvider;
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  getUserEmail?(accessToken: string): Promise<string | undefined>;
  refreshToken(refreshToken: string): Promise<OAuthTokens>;
  listCalendars(accessToken: string): Promise<SyncedCalendar[]>;
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
  createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}

// =============================================================================
// Mock Options and Tracking
// =============================================================================

/**
 * Options for creating a mock calendar provider.
 */
export interface MockCalendarProviderOptions {
  provider?: CalendarProvider;
  calendars?: SyncedCalendar[];
  events?: Map<string, ExternalCalendarEvent[]>;
  tokens?: OAuthTokens;
  userEmail?: string;
  syncToken?: string;
  shouldFailAuth?: boolean;
  shouldFailSync?: boolean;
  shouldFailPush?: boolean;
}

/**
 * Tracked operations for verifying mock interactions.
 */
export interface MockCalendarProviderTracking {
  listCalendarsCalls: number;
  getEventsCalls: { calendarId: string; syncToken?: string }[];
  createEventCalls: { calendarId: string; event: Partial<ExternalCalendarEvent> }[];
  updateEventCalls: {
    calendarId: string;
    eventId: string;
    event: Partial<ExternalCalendarEvent>;
  }[];
  deleteEventCalls: { calendarId: string; eventId: string }[];
  refreshTokenCalls: number;
}

// =============================================================================
// Mock Factory Functions
// =============================================================================

/**
 * Create a mock calendar provider for testing.
 *
 * Returns a provider that implements CalendarProviderClient with controllable behavior
 * and tracking of all method calls.
 */
export function createMockCalendarProvider(
  options: MockCalendarProviderOptions = {},
): CalendarProviderClient & { tracking: MockCalendarProviderTracking } {
  const {
    provider = 'google',
    calendars = [],
    events = new Map<string, ExternalCalendarEvent[]>(),
    tokens = {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 3600000),
    },
    userEmail = 'test@example.com',
    syncToken = 'mock-sync-token',
    shouldFailAuth = false,
    shouldFailSync = false,
    shouldFailPush = false,
  } = options;

  const tracking: MockCalendarProviderTracking = {
    listCalendarsCalls: 0,
    getEventsCalls: [],
    createEventCalls: [],
    updateEventCalls: [],
    deleteEventCalls: [],
    refreshTokenCalls: 0,
  };

  // Internal event storage (mutable for create/update/delete)
  const eventStore = new Map<string, ExternalCalendarEvent[]>();
  events.forEach((evts, calId) => eventStore.set(calId, [...evts]));

  let eventIdCounter = 1;

  return {
    provider,
    tracking,

    getAuthUrl(state: string): string {
      return `https://mock-oauth.example.com/authorize?state=${state}&provider=${provider}`;
    },

    exchangeCode(_code: string): Promise<OAuthTokens> {
      if (shouldFailAuth) {
        return Promise.reject(new Error('Mock auth failure: invalid code'));
      }
      return Promise.resolve({ ...tokens });
    },

    getUserEmail(_accessToken: string): Promise<string | undefined> {
      if (shouldFailAuth) {
        return Promise.reject(new Error('Mock auth failure: invalid token'));
      }
      return Promise.resolve(userEmail);
    },

    refreshToken(_refreshToken: string): Promise<OAuthTokens> {
      tracking.refreshTokenCalls++;
      if (shouldFailAuth) {
        return Promise.reject(new Error('Mock auth failure: refresh token expired'));
      }
      return Promise.resolve({
        ...tokens,
        accessToken: `refreshed-${tokens.accessToken}`,
        expiresAt: new Date(Date.now() + 3600000),
      });
    },

    listCalendars(_accessToken: string): Promise<SyncedCalendar[]> {
      tracking.listCalendarsCalls++;
      if (shouldFailSync) {
        return Promise.reject(new Error('Mock sync failure: unable to list calendars'));
      }
      return Promise.resolve([...calendars]);
    },

    getEvents(
      _accessToken: string,
      calendarId: string,
      opts?: {
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
    }> {
      tracking.getEventsCalls.push({ calendarId, syncToken: opts?.syncToken });

      if (shouldFailSync) {
        return Promise.reject(new Error('Mock sync failure: unable to fetch events'));
      }

      const calendarEvents = eventStore.get(calendarId) ?? [];

      // Filter by time range if provided
      let filtered = calendarEvents;
      if (opts?.timeMin) {
        const timeMin = opts.timeMin;
        filtered = filtered.filter((e) => e.startTime >= timeMin);
      }
      if (opts?.timeMax) {
        const timeMax = opts.timeMax;
        filtered = filtered.filter((e) => e.startTime <= timeMax);
      }

      // Simulate pagination
      const maxResults = opts?.maxResults ?? 100;
      const startIndex = opts?.pageToken ? parseInt(opts.pageToken, 10) : 0;
      const page = filtered.slice(startIndex, startIndex + maxResults);
      const hasMore = startIndex + maxResults < filtered.length;

      return Promise.resolve({
        events: page,
        nextSyncToken: syncToken,
        nextPageToken: hasMore ? String(startIndex + maxResults) : undefined,
        fullSync: !opts?.syncToken,
      });
    },

    createEvent(
      _accessToken: string,
      calendarId: string,
      event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
    ): Promise<ExternalCalendarEvent> {
      tracking.createEventCalls.push({ calendarId, event });

      if (shouldFailPush) {
        return Promise.reject(new Error('Mock push failure: unable to create event'));
      }

      const newEvent: ExternalCalendarEvent = {
        ...event,
        externalId: `mock-event-${String(eventIdCounter++)}`,
        calendarId,
        etag: `etag-${String(Date.now())}`,
        iCalUID: `${String(Date.now())}@mock.calendar`,
      };

      const calendarEvents = eventStore.get(calendarId) ?? [];
      calendarEvents.push(newEvent);
      eventStore.set(calendarId, calendarEvents);

      return Promise.resolve(newEvent);
    },

    updateEvent(
      _accessToken: string,
      calendarId: string,
      eventId: string,
      event: Partial<ExternalCalendarEvent>,
    ): Promise<ExternalCalendarEvent> {
      tracking.updateEventCalls.push({ calendarId, eventId, event });

      if (shouldFailPush) {
        return Promise.reject(new Error('Mock push failure: unable to update event'));
      }

      const calendarEvents = eventStore.get(calendarId) ?? [];
      const index = calendarEvents.findIndex((e) => e.externalId === eventId);

      if (index === -1) {
        return Promise.reject(new Error(`Event ${eventId} not found in calendar ${calendarId}`));
      }

      const existingEvent = calendarEvents[index];
      if (!existingEvent) {
        return Promise.reject(new Error(`Event ${eventId} not found in calendar ${calendarId}`));
      }

      const updatedEvent: ExternalCalendarEvent = {
        ...existingEvent,
        ...event,
        etag: `etag-${String(Date.now())}`,
      };

      calendarEvents[index] = updatedEvent;
      eventStore.set(calendarId, calendarEvents);

      return Promise.resolve(updatedEvent);
    },

    deleteEvent(_accessToken: string, calendarId: string, eventId: string): Promise<void> {
      tracking.deleteEventCalls.push({ calendarId, eventId });

      if (shouldFailPush) {
        return Promise.reject(new Error('Mock push failure: unable to delete event'));
      }

      const calendarEvents = eventStore.get(calendarId) ?? [];
      const index = calendarEvents.findIndex((e) => e.externalId === eventId);

      if (index === -1) {
        return Promise.reject(new Error(`Event ${eventId} not found in calendar ${calendarId}`));
      }

      calendarEvents.splice(index, 1);
      eventStore.set(calendarId, calendarEvents);

      return Promise.resolve();
    },
  };
}

/**
 * Create a mock OAuth tokens response.
 */
export function createMockOAuthTokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: 'mock-access-token-' + Math.random().toString(36).substring(7),
    refreshToken: 'mock-refresh-token-' + Math.random().toString(36).substring(7),
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 3600000),
    scope: 'calendar.read calendar.write',
    ...overrides,
  };
}

/**
 * Create mock Google Calendar API responses.
 */
export function createMockGoogleResponses(
  calendars: SyncedCalendar[],
  events: ExternalCalendarEvent[],
): Map<string, Response> {
  const responses = new Map<string, Response>();

  // Calendar list response
  responses.set(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    new Response(
      JSON.stringify({
        kind: 'calendar#calendarList',
        items: calendars.map((cal) => ({
          id: cal.externalId,
          summary: cal.name,
          backgroundColor: cal.color,
          primary: cal.isPrimary,
          accessRole: cal.canEdit ? 'owner' : 'reader',
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  // Events list response for each calendar
  calendars.forEach((cal) => {
    const calendarEvents = events.filter((e) => e.calendarId === cal.externalId);
    responses.set(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.externalId)}/events`,
      new Response(
        JSON.stringify({
          kind: 'calendar#events',
          items: calendarEvents.map((e) => ({
            id: e.externalId,
            summary: e.title,
            description: e.description,
            start: e.isAllDay
              ? { date: e.startTime.toISOString().split('T')[0] }
              : { dateTime: e.startTime.toISOString() },
            end: e.endTime
              ? e.isAllDay
                ? { date: e.endTime.toISOString().split('T')[0] }
                : { dateTime: e.endTime.toISOString() }
              : undefined,
            location: e.location,
            status: e.status,
            visibility: e.visibility,
            etag: e.etag,
            iCalUID: e.iCalUID,
          })),
          nextSyncToken: 'mock-sync-token',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });

  return responses;
}

/**
 * Create mock Outlook Calendar API responses.
 */
export function createMockOutlookResponses(
  calendars: SyncedCalendar[],
  events: ExternalCalendarEvent[],
): Map<string, Response> {
  const responses = new Map<string, Response>();

  // Calendar list response
  responses.set(
    'https://graph.microsoft.com/v1.0/me/calendars',
    new Response(
      JSON.stringify({
        value: calendars.map((cal) => ({
          id: cal.externalId,
          name: cal.name,
          color: cal.color ? 'preset' + cal.color.slice(1, 3) : 'auto',
          isDefaultCalendar: cal.isPrimary,
          canEdit: cal.canEdit ?? true,
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  // Events list response for each calendar
  calendars.forEach((cal) => {
    const calendarEvents = events.filter((e) => e.calendarId === cal.externalId);
    responses.set(
      `https://graph.microsoft.com/v1.0/me/calendars/${cal.externalId}/events`,
      new Response(
        JSON.stringify({
          value: calendarEvents.map((e) => ({
            id: e.externalId,
            subject: e.title,
            bodyPreview: e.description,
            start: { dateTime: e.startTime.toISOString(), timeZone: 'UTC' },
            end: e.endTime ? { dateTime: e.endTime.toISOString(), timeZone: 'UTC' } : undefined,
            isAllDay: e.isAllDay,
            location: e.location ? { displayName: e.location } : undefined,
            showAs: e.status === 'tentative' ? 'tentative' : 'busy',
            sensitivity: e.visibility === 'private' ? 'private' : 'normal',
            '@odata.etag': e.etag,
            iCalUId: e.iCalUID,
          })),
          '@odata.deltaLink':
            'https://graph.microsoft.com/v1.0/me/calendars/events/delta?token=mock',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });

  return responses;
}
