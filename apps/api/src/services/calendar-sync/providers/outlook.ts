/**
 * Outlook Calendar provider (Microsoft Graph API).
 *
 * @packageDocumentation
 */

import { Client } from '@microsoft/microsoft-graph-client';
import type { Calendar, Event } from '@microsoft/microsoft-graph-types';
import type {
  CalendarProviderClient,
  OAuthTokens,
  SyncedCalendar,
  ExternalCalendarEvent,
  OAuthConfig,
  WebhookWatch,
} from '../types.js';

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

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
    const client = this.createClient(accessToken);
    const calendars: SyncedCalendar[] = [];
    let nextLink: string | undefined = '/me/calendars';
    let includeSelect = true;

    while (nextLink) {
      const request = client.api(nextLink);
      if (includeSelect) {
        request.select('id,name,color,isDefaultCalendar,canEdit');
      }

      const response = (await request.get()) as {
        value?: Calendar[];
        '@odata.nextLink'?: string;
      };

      const batch = (response.value ?? []) as (Calendar & {
        id: string;
        name: string;
        canEdit?: boolean;
      })[];

      calendars.push(
        ...batch.map((cal) => {
          const canEdit = cal.canEdit ?? false;
          return {
            id: cal.id,
            externalId: cal.id,
            name: cal.name,
            color: this.mapOutlookColor(cal.color ?? undefined),
            isPrimary: cal.isDefaultCalendar ?? false,
            canEdit,
            syncEnabled: true,
            syncDirection: canEdit ? ('bidirectional' as const) : ('pull' as const),
          };
        }),
      );

      nextLink = response['@odata.nextLink'];
      includeSelect = false;
    }

    return calendars;
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
    const client = this.createClient(accessToken);

    if (options.pageToken || options.syncToken) {
      const deltaResponse = (await client
        .api(options.pageToken ?? options.syncToken ?? '')
        .header('Prefer', 'odata.maxpagesize=50')
        .get()) as GraphDeltaResponse;

      const events = (deltaResponse.value ?? []) as (Event & { id: string })[];

      return {
        events: events.map((item) => this.mapOutlookEvent(item, calendarId)),
        nextSyncToken: deltaResponse['@odata.deltaLink'] ?? undefined,
        nextPageToken: deltaResponse['@odata.nextLink'] ?? undefined,
        fullSync: !options.syncToken,
      };
    }

    const request = client
      .api(`/me/calendars/${encodeURIComponent(calendarId)}/events`)
      .header('Prefer', 'odata.maxpagesize=50')
      .select(
        'id,subject,body,start,end,isAllDay,location,recurrence,attendees,showAs,sensitivity,iCalUId,changeKey,isCancelled',
      );

    if (options.timeMin || options.timeMax) {
      const filters: string[] = [];
      if (options.timeMin) {
        filters.push(`start/dateTime ge '${options.timeMin.toISOString()}'`);
      }
      if (options.timeMax) {
        filters.push(`end/dateTime le '${options.timeMax.toISOString()}'`);
      }
      request.filter(filters.join(' and '));
    }

    if (options.maxResults) {
      request.top(options.maxResults);
    }

    const response = (await request.get()) as GraphDeltaResponse;
    const events = (response.value ?? []) as (Event & { id: string })[];

    return {
      events: events.map((item) => this.mapOutlookEvent(item, calendarId)),
      nextSyncToken: response['@odata.deltaLink'] ?? undefined,
      nextPageToken: response['@odata.nextLink'] ?? undefined,
      fullSync: !options.syncToken,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent> {
    const client = this.createClient(accessToken);
    const outlookEvent = this.mapToOutlookEvent(event);

    const response = (await client
      .api(`/me/calendars/${encodeURIComponent(calendarId)}/events`)
      .post(outlookEvent)) as Event & { id: string };

    return this.mapOutlookEvent(response, calendarId);
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent> {
    const client = this.createClient(accessToken);
    const outlookEvent = this.mapToOutlookEvent(event as ExternalCalendarEvent);

    const response = (await client
      .api(`/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
      .patch(outlookEvent)) as Event & { id: string };

    return this.mapOutlookEvent(response, calendarId);
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const client = this.createClient(accessToken);
    try {
      await client
        .api(
          `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        )
        .delete();
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404) {
        return;
      }
      throw error;
    }
  }

  async getUserEmail(accessToken: string): Promise<string | undefined> {
    try {
      const client = this.createClient(accessToken);
      const user = (await client.api('/me').select('mail,userPrincipalName').get()) as {
        mail?: string;
        userPrincipalName?: string;
      };
      return user.mail ?? user.userPrincipalName;
    } catch {
      return undefined;
    }
  }

  private createClient(accessToken: string): Client {
    return Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });
  }

  private mapOutlookEvent(
    event: Event & { id: string },
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
      externalId: event.id,
      calendarId,
      title: event.subject ?? '(No title)',
      description: event.body?.content ?? undefined,
      startTime,
      endTime,
      isAllDay,
      location: event.location?.displayName ?? undefined,
      recurrenceRule: this.parseOutlookRecurrence(event.recurrence),
      attendees: event.attendees?.map((attendee) => ({
        email: attendee.emailAddress?.address ?? '',
        name: attendee.emailAddress?.name ?? undefined,
        status: this.mapAttendeeStatus(attendee.status?.response ?? undefined),
        isOrganizer: attendee.type === 'required',
      })),
      status: event.isCancelled ? 'cancelled' : this.mapShowAs(event.showAs ?? undefined),
      visibility: this.mapSensitivity(event.sensitivity ?? undefined),
      etag: event.changeKey ?? undefined,
      iCalUID: event.iCalUId ?? undefined,
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
      outlookEvent.start = {
        dateTime: event.startTime.toISOString().split('T')[0],
        timeZone: 'UTC',
      };
      if (event.endTime) {
        outlookEvent.end = {
          dateTime: event.endTime.toISOString().split('T')[0],
          timeZone: 'UTC',
        };
      }
    } else {
      outlookEvent.start = {
        dateTime: event.startTime.toISOString(),
        timeZone: 'UTC',
      };
      if (event.endTime) {
        outlookEvent.end = {
          dateTime: event.endTime.toISOString(),
          timeZone: 'UTC',
        };
      }
    }

    return outlookEvent;
  }

  private parseOutlookRecurrence(recurrence?: Event['recurrence']): string | undefined {
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
            .map((day) => day.substring(0, 2).toUpperCase())
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

  /**
   * Create a webhook subscription for real-time calendar notifications.
   *
   * Microsoft Graph subscriptions:
   * - Max expiration: 3 days for calendar events
   * - Must respond to validation request with validationToken
   */
  async createWatch(
    accessToken: string,
    calendarId: string,
    webhookUrl: string,
    channelToken: string,
  ): Promise<WebhookWatch> {
    const client = this.createClient(accessToken);

    // Subscription expires in 3 days (Microsoft's max for calendar events)
    const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    // Resource path for calendar events
    const resource = calendarId === 'primary' ? '/me/events' : `/me/calendars/${calendarId}/events`;

    const subscription = (await client.api('/subscriptions').post({
      changeType: 'created,updated,deleted',
      notificationUrl: webhookUrl,
      resource,
      expirationDateTime,
      clientState: channelToken,
    })) as { id: string; expirationDateTime: string };

    return {
      id: subscription.id,
      expiresAt: new Date(subscription.expirationDateTime),
      calendarId,
    };
  }

  /**
   * Stop a webhook subscription.
   */
  async stopWatch(accessToken: string, watch: WebhookWatch): Promise<void> {
    const client = this.createClient(accessToken);
    await client.api(`/subscriptions/${watch.id}`).delete();
  }
}

interface GraphDeltaResponse {
  value?: Event[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}
