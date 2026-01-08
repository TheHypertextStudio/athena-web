/**
 * Google Calendar provider.
 *
 * @packageDocumentation
 */

import type {
  CalendarProviderClient,
  OAuthTokens,
  SyncedCalendar,
  ExternalCalendarEvent,
  OAuthConfig,
} from '../types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Google Calendar provider implementation.
 */
export class GoogleCalendarProvider implements CalendarProviderClient {
  readonly provider = 'google' as const;
  private readonly config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh token: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken, // Keep the existing refresh token
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  async listCalendars(accessToken: string): Promise<SyncedCalendar[]> {
    const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list calendars: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      items: {
        id: string;
        summary: string;
        backgroundColor?: string;
        primary?: boolean;
      }[];
    };

    return data.items.map((cal) => ({
      id: cal.id,
      externalId: cal.id,
      name: cal.summary,
      color: cal.backgroundColor,
      isPrimary: cal.primary ?? false,
      syncEnabled: true,
      syncDirection: 'bidirectional' as const,
    }));
  }

  async getEvents(
    accessToken: string,
    calendarId: string,
    options: {
      timeMin?: Date;
      timeMax?: Date;
      syncToken?: string;
      maxResults?: number;
    } = {},
  ): Promise<{
    events: ExternalCalendarEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams();

    if (options.syncToken) {
      params.set('syncToken', options.syncToken);
    } else {
      if (options.timeMin) {
        params.set('timeMin', options.timeMin.toISOString());
      }
      if (options.timeMax) {
        params.set('timeMax', options.timeMax.toISOString());
      }
    }

    if (options.maxResults) {
      params.set('maxResults', String(options.maxResults));
    }

    params.set('singleEvents', 'false'); // Get recurring event masters
    params.set('showDeleted', 'true'); // For sync purposes

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get events: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      items?: GoogleCalendarEvent[];
      nextSyncToken?: string;
      nextPageToken?: string;
    };

    const events = (data.items ?? [])
      .filter((item) => item.status !== 'cancelled')
      .map((item) => this.mapGoogleEvent(item, calendarId));

    return {
      events,
      nextSyncToken: data.nextSyncToken,
      nextPageToken: data.nextPageToken,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent> {
    const googleEvent = this.mapToGoogleEvent(event);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googleEvent),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to create event: ${response.statusText}`);
    }

    const data = (await response.json()) as GoogleCalendarEvent;
    return this.mapGoogleEvent(data, calendarId);
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent> {
    const googleEvent = this.mapToGoogleEvent(event as ExternalCalendarEvent);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googleEvent),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to update event: ${response.statusText}`);
    }

    const data = (await response.json()) as GoogleCalendarEvent;
    return this.mapGoogleEvent(data, calendarId);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete event: ${response.statusText}`);
    }
  }

  private mapGoogleEvent(event: GoogleCalendarEvent, calendarId: string): ExternalCalendarEvent {
    const isAllDay = !!event.start?.date;
    const startTime = isAllDay
      ? new Date(event.start?.date ?? '')
      : new Date(event.start?.dateTime ?? '');
    const endTime = event.end
      ? isAllDay
        ? new Date(event.end.date ?? '')
        : new Date(event.end.dateTime ?? '')
      : undefined;

    return {
      externalId: event.id ?? '',
      calendarId,
      title: event.summary ?? '(No title)',
      description: event.description,
      startTime,
      endTime,
      isAllDay,
      location: event.location,
      recurrenceRule: event.recurrence?.[0],
      attendees: event.attendees?.map((a) => ({
        email: a.email ?? '',
        name: a.displayName,
        status: this.mapResponseStatus(a.responseStatus),
        isOrganizer: a.organizer ?? false,
      })),
      status: this.mapEventStatus(event.status),
      visibility: this.mapVisibility(event.visibility),
      etag: event.etag,
      iCalUID: event.iCalUID,
    };
  }

  private mapToGoogleEvent(
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Record<string, unknown> {
    const googleEvent: Record<string, unknown> = {
      summary: event.title,
      description: event.description,
      location: event.location,
    };

    if (event.isAllDay) {
      googleEvent['start'] = { date: event.startTime.toISOString().split('T')[0] };
      if (event.endTime) {
        googleEvent['end'] = { date: event.endTime.toISOString().split('T')[0] };
      }
    } else {
      googleEvent['start'] = { dateTime: event.startTime.toISOString() };
      if (event.endTime) {
        googleEvent['end'] = { dateTime: event.endTime.toISOString() };
      }
    }

    if (event.recurrenceRule) {
      googleEvent['recurrence'] = [event.recurrenceRule];
    }

    return googleEvent;
  }

  private mapEventStatus(status?: string): 'confirmed' | 'tentative' | 'cancelled' {
    switch (status) {
      case 'tentative':
        return 'tentative';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'confirmed';
    }
  }

  private mapResponseStatus(status?: string): 'pending' | 'accepted' | 'declined' | 'tentative' {
    switch (status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'tentative':
        return 'tentative';
      default:
        return 'pending';
    }
  }

  private mapVisibility(visibility?: string): 'public' | 'private' | 'confidential' {
    switch (visibility) {
      case 'private':
        return 'private';
      case 'confidential':
        return 'confidential';
      default:
        return 'public';
    }
  }
}

/**
 * Google Calendar API event type.
 */
interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  recurrence?: string[];
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
  }[];
  status?: string;
  visibility?: string;
  etag?: string;
  iCalUID?: string;
}
