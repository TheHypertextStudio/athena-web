/**
 * Outlook Calendar provider (Microsoft Graph API).
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

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/**
 * Microsoft Graph event type.
 */
interface MicrosoftCalendarEvent {
  id?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  location?: { displayName?: string };
  recurrence?: {
    pattern?: {
      type?: string;
      interval?: number;
      daysOfWeek?: string[];
    };
    range?: {
      type?: string;
      startDate?: string;
      endDate?: string;
    };
  };
  attendees?: {
    emailAddress?: { address?: string; name?: string };
    status?: { response?: string };
    type?: string;
  }[];
  showAs?: string;
  sensitivity?: string;
  iCalUId?: string;
  changeKey?: string;
  isCancelled?: boolean;
}

/**
 * Outlook Calendar provider implementation.
 */
export class OutlookCalendarProvider implements CalendarProviderClient {
  readonly provider = 'outlook' as const;
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
      response_mode: 'query',
      state,
    });

    return `${MICROSOFT_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const response = await fetch(MICROSOFT_TOKEN_URL, {
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
    const response = await fetch(MICROSOFT_TOKEN_URL, {
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
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  async listCalendars(accessToken: string): Promise<SyncedCalendar[]> {
    const response = await fetch(`${GRAPH_API}/me/calendars`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list calendars: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      value: {
        id: string;
        name: string;
        color?: string;
        isDefaultCalendar?: boolean;
        canEdit?: boolean;
      }[];
    };

    return data.value.map((cal) => ({
      id: cal.id,
      externalId: cal.id,
      name: cal.name,
      color: this.mapOutlookColor(cal.color),
      isPrimary: cal.isDefaultCalendar ?? false,
      syncEnabled: true,
      syncDirection: cal.canEdit ? ('bidirectional' as const) : ('pull' as const),
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
    let url: string;

    if (options.syncToken) {
      // Use delta query for incremental sync
      url = options.syncToken;
    } else {
      // Initial sync with time range
      const params = new URLSearchParams();

      if (options.timeMin || options.timeMax) {
        const filters: string[] = [];
        if (options.timeMin) {
          filters.push(`start/dateTime ge '${options.timeMin.toISOString()}'`);
        }
        if (options.timeMax) {
          filters.push(`end/dateTime le '${options.timeMax.toISOString()}'`);
        }
        params.set('$filter', filters.join(' and '));
      }

      if (options.maxResults) {
        params.set('$top', String(options.maxResults));
      }

      params.set(
        '$select',
        'id,subject,body,start,end,isAllDay,location,recurrence,attendees,showAs,sensitivity,iCalUId,changeKey,isCancelled',
      );

      url = `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'odata.maxpagesize=50',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get events: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      value?: MicrosoftCalendarEvent[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };

    const events = (data.value ?? [])
      .filter((item) => !item.isCancelled)
      .map((item) => this.mapOutlookEvent(item, calendarId));

    return {
      events,
      nextSyncToken: data['@odata.deltaLink'],
      nextPageToken: data['@odata.nextLink'],
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent> {
    const outlookEvent = this.mapToOutlookEvent(event);

    const response = await fetch(
      `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(outlookEvent),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to create event: ${response.statusText}`);
    }

    const data = (await response.json()) as MicrosoftCalendarEvent;
    return this.mapOutlookEvent(data, calendarId);
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent> {
    const outlookEvent = this.mapToOutlookEvent(event as ExternalCalendarEvent);

    const response = await fetch(
      `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(outlookEvent),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to update event: ${response.statusText}`);
    }

    const data = (await response.json()) as MicrosoftCalendarEvent;
    return this.mapOutlookEvent(data, calendarId);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const response = await fetch(
      `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
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

  private mapOutlookEvent(
    event: MicrosoftCalendarEvent,
    calendarId: string,
  ): ExternalCalendarEvent {
    const isAllDay = event.isAllDay ?? false;
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime + (event.start.timeZone === 'UTC' ? 'Z' : ''))
      : new Date();
    const endTime = event.end?.dateTime
      ? new Date(event.end.dateTime + (event.end.timeZone === 'UTC' ? 'Z' : ''))
      : undefined;

    return {
      externalId: event.id ?? '',
      calendarId,
      title: event.subject ?? '(No title)',
      description: event.body?.content,
      startTime,
      endTime,
      isAllDay,
      location: event.location?.displayName,
      recurrenceRule: this.parseOutlookRecurrence(event.recurrence),
      attendees: event.attendees?.map((a) => ({
        email: a.emailAddress?.address ?? '',
        name: a.emailAddress?.name,
        status: this.mapAttendeeStatus(a.status?.response),
        isOrganizer: a.type === 'required',
      })),
      status: this.mapShowAs(event.showAs),
      visibility: this.mapSensitivity(event.sensitivity),
      etag: event.changeKey,
      iCalUID: event.iCalUId,
    };
  }

  private mapToOutlookEvent(
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Record<string, unknown> {
    const outlookEvent: Record<string, unknown> = {
      subject: event.title,
      body: event.description ? { content: event.description, contentType: 'text' } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      isAllDay: event.isAllDay,
    };

    if (event.isAllDay) {
      outlookEvent['start'] = {
        dateTime: event.startTime.toISOString().split('T')[0],
        timeZone: 'UTC',
      };
      if (event.endTime) {
        outlookEvent['end'] = {
          dateTime: event.endTime.toISOString().split('T')[0],
          timeZone: 'UTC',
        };
      }
    } else {
      outlookEvent['start'] = {
        dateTime: event.startTime.toISOString(),
        timeZone: 'UTC',
      };
      if (event.endTime) {
        outlookEvent['end'] = {
          dateTime: event.endTime.toISOString(),
          timeZone: 'UTC',
        };
      }
    }

    return outlookEvent;
  }

  private parseOutlookRecurrence(
    recurrence?: MicrosoftCalendarEvent['recurrence'],
  ): string | undefined {
    if (!recurrence?.pattern) return undefined;

    // Convert Microsoft recurrence to RRULE format
    const parts: string[] = ['RRULE:'];

    switch (recurrence.pattern.type) {
      case 'daily':
        parts.push(`FREQ=DAILY;INTERVAL=${String(recurrence.pattern.interval ?? 1)}`);
        break;
      case 'weekly':
        parts.push(`FREQ=WEEKLY;INTERVAL=${String(recurrence.pattern.interval ?? 1)}`);
        if (recurrence.pattern.daysOfWeek?.length) {
          const days = recurrence.pattern.daysOfWeek
            .map((d) => d.substring(0, 2).toUpperCase())
            .join(',');
          parts.push(`;BYDAY=${days}`);
        }
        break;
      case 'absoluteMonthly':
        parts.push(`FREQ=MONTHLY;INTERVAL=${String(recurrence.pattern.interval ?? 1)}`);
        break;
      case 'absoluteYearly':
        parts.push(`FREQ=YEARLY;INTERVAL=${String(recurrence.pattern.interval ?? 1)}`);
        break;
      default:
        return undefined;
    }

    if (recurrence.range?.endDate) {
      parts.push(`;UNTIL=${recurrence.range.endDate.replace(/-/g, '')}`);
    }

    return parts.join('');
  }

  private mapAttendeeStatus(status?: string): 'pending' | 'accepted' | 'declined' | 'tentative' {
    switch (status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'tentativelyAccepted':
        return 'tentative';
      default:
        return 'pending';
    }
  }

  private mapShowAs(showAs?: string): 'confirmed' | 'tentative' | 'cancelled' {
    switch (showAs) {
      case 'tentative':
        return 'tentative';
      case 'free':
        return 'confirmed';
      default:
        return 'confirmed';
    }
  }

  private mapSensitivity(sensitivity?: string): 'public' | 'private' | 'confidential' {
    switch (sensitivity) {
      case 'private':
        return 'private';
      case 'confidential':
        return 'confidential';
      default:
        return 'public';
    }
  }

  private mapOutlookColor(color?: string): string | undefined {
    // Microsoft uses predefined color categories
    const colorMap: Record<string, string> = {
      auto: '#0078d4',
      lightBlue: '#71afe5',
      lightGreen: '#7ed321',
      lightOrange: '#ffb900',
      lightGray: '#a0aeb2',
      lightYellow: '#fff100',
      lightTeal: '#00b294',
      lightPink: '#e3008c',
      lightBrown: '#a0522d',
      lightRed: '#e81123',
    };
    return color ? (colorMap[color] ?? color) : undefined;
  }
}
