/**
 * Google Calendar provider.
 *
 * @packageDocumentation
 */

import { google, calendar_v3, oauth2_v2 } from 'googleapis';

/**
 * OAuth2 credentials shape from Google Auth library.
 */
interface GoogleCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
}

/**
 * Minimal OAuth2 client interface matching what we use from googleapis.
 * Defined explicitly to satisfy strict ESLint type checking since
 * googleapis SDK types don't resolve properly under bundler resolution.
 */
interface GoogleOAuth2Client {
  setCredentials(credentials: GoogleCredentials): void;
  getAccessToken(): Promise<{ token?: string | null }>;
  credentials: GoogleCredentials;
}

import type {
  CalendarProviderClient,
  OAuthTokens,
  SyncedCalendar,
  ExternalCalendarEvent,
  OAuthConfig,
} from '../types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

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

  /**
   * Get user email from Google profile.
   */
  async getUserEmail(accessToken: string): Promise<string | undefined> {
    try {
      const auth = this.createAuthClient(accessToken);
      const oauth2 = new oauth2_v2.Oauth2({ auth });
      const response = await oauth2.userinfo.get();
      const email = response.data.email;
      return typeof email === 'string' ? email : undefined;
    } catch {
      return undefined;
    }
  }

  async listCalendars(accessToken: string): Promise<SyncedCalendar[]> {
    const calendar = this.createCalendarClient(accessToken);
    const items: (calendar_v3.Schema$CalendarListEntry & { id: string; summary: string })[] = [];
    let pageToken: string | undefined;

    do {
      const response = await calendar.calendarList.list({ pageToken: pageToken ?? undefined });
      const batch = (response.data.items ?? []) as (calendar_v3.Schema$CalendarListEntry & {
        id: string;
        summary: string;
      })[];
      items.push(...batch);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return items.map((cal) => {
      const canEdit = cal.accessRole === 'owner' || cal.accessRole === 'writer';
      return {
        id: cal.id,
        externalId: cal.id,
        name: cal.summary,
        color: cal.backgroundColor ?? undefined,
        isPrimary: cal.primary ?? false,
        canEdit,
        syncEnabled: true,
        syncDirection: canEdit ? ('bidirectional' as const) : ('pull' as const),
      };
    });
  }

  async getEvents(
    accessToken: string,
    calendarId: string,
    options: {
      timeMin?: Date;
      timeMax?: Date;
      syncToken?: string;
      maxResults?: number;
      pageToken?: string;
    } = {},
  ): Promise<{
    events: ExternalCalendarEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
    fullSync?: boolean;
  }> {
    const calendar = this.createCalendarClient(accessToken);
    // When singleEvents: true, Google expands recurring events into individual instances
    // This is incompatible with syncToken, so we always use time-range based fetching
    const response = await calendar.events.list({
      calendarId,
      timeMin: options.timeMin?.toISOString(),
      timeMax: options.timeMax?.toISOString(),
      maxResults: options.maxResults ?? undefined,
      pageToken: options.pageToken ?? undefined,
      singleEvents: true,
      showDeleted: true,
    });

    const items = (response.data.items ?? []) as (calendar_v3.Schema$Event & { id: string })[];
    const events = items.map((item) => this.mapGoogleEvent(item, calendarId));

    return {
      events,
      nextSyncToken: response.data.nextSyncToken ?? undefined,
      nextPageToken: response.data.nextPageToken ?? undefined,
      fullSync: !options.syncToken,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent> {
    const calendar = this.createCalendarClient(accessToken);
    const googleEvent = this.mapToGoogleEvent(event);

    const response = await calendar.events.insert({
      calendarId,
      requestBody: googleEvent,
    });

    const data = response.data as calendar_v3.Schema$Event & { id: string };
    return this.mapGoogleEvent(data, calendarId);
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent> {
    const calendar = this.createCalendarClient(accessToken);
    const googleEvent = this.mapToGoogleEvent(event as ExternalCalendarEvent);

    const response = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: googleEvent,
    });

    const data = response.data as calendar_v3.Schema$Event & { id: string };
    return this.mapGoogleEvent(data, calendarId);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const calendar = this.createCalendarClient(accessToken);
    try {
      await calendar.events.delete({
        calendarId,
        eventId,
      });
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        return;
      }
      throw error;
    }
  }

  private createAuthClient(accessToken: string): GoogleOAuth2Client {
    // google.auth.OAuth2 returns a properly typed client at runtime
    // Explicit constructor typing needed because googleapis SDK types don't resolve under strict ESLint
    const OAuth2Constructor = google.auth.OAuth2 as new (
      clientId?: string,
      clientSecret?: string,
      redirectUri?: string,
    ) => GoogleOAuth2Client;

    const client = new OAuth2Constructor(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri,
    );
    client.setCredentials({ access_token: accessToken });
    return client;
  }

  private createCalendarClient(accessToken: string): calendar_v3.Calendar {
    const auth = this.createAuthClient(accessToken);
    return new calendar_v3.Calendar({ auth });
  }

  private mapGoogleEvent(
    event: calendar_v3.Schema$Event & { id: string },
    calendarId: string,
  ): ExternalCalendarEvent {
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
      externalId: event.id,
      calendarId,
      title: event.summary ?? '(No title)',
      description: event.description ?? undefined,
      startTime,
      endTime,
      isAllDay,
      location: event.location ?? undefined,
      recurrenceRule: event.recurrence?.[0],
      attendees: event.attendees?.map((attendee) => ({
        email: attendee.email ?? '',
        name: attendee.displayName ?? undefined,
        status: this.mapResponseStatus(attendee.responseStatus ?? undefined),
        isOrganizer: attendee.organizer ?? false,
      })),
      status: this.mapEventStatus(event.status ?? undefined),
      visibility: this.mapVisibility(event.visibility ?? undefined),
      etag: event.etag ?? undefined,
      iCalUID: event.iCalUID ?? undefined,
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
      googleEvent.start = { date: event.startTime.toISOString().split('T')[0] };
      if (event.endTime) {
        googleEvent.end = { date: event.endTime.toISOString().split('T')[0] };
      }
    } else {
      googleEvent.start = { dateTime: event.startTime.toISOString() };
      if (event.endTime) {
        googleEvent.end = { dateTime: event.endTime.toISOString() };
      }
    }

    if (event.recurrenceRule) {
      googleEvent.recurrence = [event.recurrenceRule];
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
