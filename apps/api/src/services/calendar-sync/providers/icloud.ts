/**
 * iCloud Calendar provider (CalDAV-based).
 *
 * iCloud Calendar uses CalDAV protocol with app-specific password authentication.
 * Users must generate an app-specific password at appleid.apple.com for third-party access.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import type {
  CalendarProviderClient,
  OAuthTokens,
  SyncedCalendar,
  ExternalCalendarEvent,
} from '../types.js';

const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com';

/**
 * iCloud Calendar provider implementation.
 *
 * Note: iCloud doesn't use OAuth. Instead, it uses:
 * - Apple ID email as username
 * - App-specific password (generated at appleid.apple.com)
 *
 * The "accessToken" for this provider is a Base64-encoded "username:password" string.
 */
export class ICloudCalendarProvider implements CalendarProviderClient {
  readonly provider = 'icloud' as const;
  private readonly baseUrl: string;

  constructor(baseUrl: string = ICLOUD_CALDAV_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * iCloud doesn't use OAuth. Returns a placeholder URL.
   * The application should show a custom form for Apple ID + app-specific password.
   */
  getAuthUrl(state: string): string {
    // Return a URL that the app can intercept to show credential entry form
    return `athena://icloud-auth?state=${encodeURIComponent(state)}`;
  }

  /**
   * For iCloud, the "code" is expected to be Base64-encoded "appleId:appSpecificPassword".
   * This validates the credentials and returns them as tokens.
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    // Decode and validate credentials format
    let credentials: string;
    try {
      credentials = Buffer.from(code, 'base64').toString('utf-8');
    } catch {
      throw new Error('Invalid credentials format');
    }

    const [username, password] = credentials.split(':');
    if (!username || !password) {
      throw new Error('Credentials must be in format "appleId:appSpecificPassword"');
    }

    // Validate credentials by making a PROPFIND request
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${code}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Apple ID or app-specific password');
      }
      throw new Error(`Failed to authenticate: ${response.statusText}`);
    }

    // Credentials are valid - return them as "tokens"
    // iCloud uses Basic Auth, so tokens don't expire
    return {
      accessToken: code, // Store Base64 credentials as access token
      refreshToken: code, // Same credentials can be reused
      tokenType: 'Basic',
      // No expiry - app-specific passwords don't expire unless revoked
    };
  }

  /**
   * iCloud credentials don't expire (unless revoked), so just return the same credentials.
   */
  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    // Verify credentials are still valid
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${refreshToken}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error('Credentials no longer valid - app-specific password may have been revoked');
    }

    return {
      accessToken: refreshToken,
      refreshToken,
      tokenType: 'Basic',
    };
  }

  async listCalendars(accessToken: string): Promise<SyncedCalendar[]> {
    // First, get the user's principal URL
    const principalUrl = await this.getUserPrincipal(accessToken);

    // Then get the calendar home URL
    const calendarHomeUrl = await this.getCalendarHome(accessToken, principalUrl);

    // Finally, list calendars
    const response = await fetch(calendarHomeUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <a:calendar-color/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to list calendars: ${response.statusText}`);
    }

    const xml = await response.text();
    const calendars = this.parseCalendarList(xml, calendarHomeUrl);

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
    const currentCtag = await this.fetchCtag(accessToken, calendarId);
    if (options.syncToken && currentCtag && options.syncToken === currentCtag) {
      return {
        events: [],
        nextSyncToken: currentCtag,
        fullSync: false,
      };
    }

    // Build time-range filter if dates provided
    let timeRangeFilter = '';
    if (options.timeMin || options.timeMax) {
      const start = options.timeMin
        ? (options.timeMin.toISOString().replace(/[-:]/g, '').split('.')[0] ?? '') + 'Z'
        : undefined;
      const end = options.timeMax
        ? (options.timeMax.toISOString().replace(/[-:]/g, '').split('.')[0] ?? '') + 'Z'
        : undefined;
      timeRangeFilter = `<c:time-range${start ? ` start="${start}"` : ''}${end ? ` end="${end}"` : ''}/>`;
    }

    const response = await fetch(calendarId, {
      method: 'REPORT',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        ${timeRangeFilter}
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get events: ${response.statusText}`);
    }

    const xml = await response.text();
    const events = this.parseEventList(xml, calendarId);

    return {
      events: options.maxResults ? events.slice(0, options.maxResults) : events,
      nextSyncToken: currentCtag,
      fullSync: !options.syncToken || options.syncToken !== currentCtag,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent> {
    const uid = crypto.randomUUID();
    const icsContent = this.eventToICS(event, uid);
    const eventUrl = `${calendarId}${uid}.ics`;

    const response = await fetch(eventUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*', // Only create if doesn't exist
      },
      body: icsContent,
    });

    if (!response.ok) {
      throw new Error(`Failed to create event: ${response.statusText}`);
    }

    const etag = response.headers.get('ETag') ?? undefined;

    return {
      externalId: uid,
      calendarId,
      ...event,
      etag,
      iCalUID: uid,
    };
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>,
  ): Promise<ExternalCalendarEvent> {
    const eventUrl = `${calendarId}${eventId}.ics`;

    // First get existing event to merge changes
    const getResponse = await fetch(eventUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${accessToken}`,
      },
    });

    if (!getResponse.ok) {
      throw new Error(`Event not found: ${getResponse.statusText}`);
    }

    const existingIcs = await getResponse.text();
    const existingEvent = this.parseICSEvent(existingIcs, calendarId);
    const currentEtag = getResponse.headers.get('ETag');

    // Merge with updates
    const updatedEvent = {
      ...existingEvent,
      ...event,
    };

    const icsContent = this.eventToICS(updatedEvent, eventId);

    const response = await fetch(eventUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'text/calendar; charset=utf-8',
        ...(currentEtag ? { 'If-Match': currentEtag } : {}),
      },
      body: icsContent,
    });

    if (!response.ok) {
      if (response.status === 412) {
        throw new Error('Event was modified by another client');
      }
      throw new Error(`Failed to update event: ${response.statusText}`);
    }

    const etag = response.headers.get('ETag') ?? undefined;

    return {
      externalId: eventId,
      calendarId,
      title: updatedEvent.title,
      description: updatedEvent.description,
      startTime: updatedEvent.startTime,
      endTime: updatedEvent.endTime,
      isAllDay: updatedEvent.isAllDay,
      location: updatedEvent.location,
      recurrenceRule: updatedEvent.recurrenceRule,
      attendees: updatedEvent.attendees,
      status: updatedEvent.status,
      visibility: updatedEvent.visibility,
      etag,
      iCalUID: eventId,
    };
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const eventUrl = `${calendarId}${eventId}.ics`;

    const response = await fetch(eventUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete event: ${response.statusText}`);
    }
  }

  /**
   * Get the user's principal URL from CalDAV server.
   */
  private async getUserPrincipal(accessToken: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get user principal: ${response.statusText}`);
    }

    const xml = await response.text();
    const hrefRegex = /<d:current-user-principal[^>]*>[\s\S]*?<d:href>([^<]+)<\/d:href>/;
    const hrefMatch = hrefRegex.exec(xml);

    const principalPath = hrefMatch?.[1];
    if (!principalPath) {
      throw new Error('Could not find user principal URL');
    }

    // Handle relative URLs
    if (principalPath.startsWith('http')) {
      return principalPath;
    }
    return `${this.baseUrl}${principalPath}`;
  }

  /**
   * Get the calendar home URL for the user.
   */
  private async getCalendarHome(accessToken: string, principalUrl: string): Promise<string> {
    const response = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get calendar home: ${response.statusText}`);
    }

    const xml = await response.text();
    const hrefRegex = /<c:calendar-home-set[^>]*>[\s\S]*?<d:href>([^<]+)<\/d:href>/;
    const hrefMatch = hrefRegex.exec(xml);

    const homePath = hrefMatch?.[1];
    if (!homePath) {
      throw new Error('Could not find calendar home URL');
    }

    if (homePath.startsWith('http')) {
      return homePath;
    }
    return `${this.baseUrl}${homePath}`;
  }

  /**
   * Parse calendar list from PROPFIND XML response.
   */
  private parseCalendarList(xml: string, homeUrl: string): SyncedCalendar[] {
    const calendars: SyncedCalendar[] = [];

    // Match each response block
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;

    while ((match = responseRegex.exec(xml)) !== null) {
      const responseXml = match[1];
      if (!responseXml) continue;

      // Check if this is a calendar resource
      if (!responseXml.includes('<d:resourcetype>') || !responseXml.includes('calendar')) {
        continue;
      }

      // Skip if it's the home URL itself (not a calendar)
      const hrefRegex = /<d:href>([^<]+)<\/d:href>/;
      const hrefMatch = hrefRegex.exec(responseXml);
      const href = hrefMatch?.[1];
      if (!href) continue;
      if (href === homeUrl || href === new URL(homeUrl).pathname) continue;

      // Extract calendar properties
      const nameRegex = /<d:displayname>([^<]*)<\/d:displayname>/;
      const colorRegex = /<a:calendar-color[^>]*>([^<]*)<\/a:calendar-color>/i;
      const nameMatch = nameRegex.exec(responseXml);
      const colorMatch = colorRegex.exec(responseXml);

      const calendarUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
      const name = nameMatch?.[1] ?? 'Unnamed Calendar';
      const color = colorMatch?.[1];

      calendars.push({
        id: calendarUrl,
        externalId: calendarUrl,
        name: this.decodeHtmlEntities(name),
        color: color ? this.normalizeColor(color) : undefined,
        isPrimary: calendars.length === 0, // First calendar is primary
        canEdit: true,
        syncEnabled: true,
        syncDirection: 'bidirectional',
      });
    }

    return calendars;
  }

  /**
   * Parse event list from REPORT XML response.
   */
  private parseEventList(xml: string, calendarId: string): ExternalCalendarEvent[] {
    const events: ExternalCalendarEvent[] = [];

    // Match each response block
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;

    while ((match = responseRegex.exec(xml)) !== null) {
      const responseXml = match[1];
      if (!responseXml) continue;

      // Extract etag
      const etagRegex = /<d:getetag>"?([^"<]+)"?<\/d:getetag>/;
      const etagMatch = etagRegex.exec(responseXml);
      const etag = etagMatch?.[1];

      // Extract calendar data
      const dataRegex = /<c:calendar-data[^>]*>([\s\S]*?)<\/c:calendar-data>/;
      const dataMatch = dataRegex.exec(responseXml);
      const icsData = dataMatch?.[1];
      if (!icsData) continue;

      try {
        const event = this.parseICSEvent(this.decodeHtmlEntities(icsData), calendarId);
        events.push({ ...event, etag });
      } catch {
        // Skip malformed events
      }
    }

    return events;
  }

  /**
   * Parse a single ICS event.
   */
  private parseICSEvent(ics: string, calendarId: string): ExternalCalendarEvent {
    const lines = ics.split(/\r?\n/);
    const props: Record<string, string> = {};

    // Unfold long lines (lines starting with space/tab are continuations)
    const unfoldedLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        const lastIndex = unfoldedLines.length - 1;
        if (lastIndex >= 0 && unfoldedLines[lastIndex] !== undefined) {
          unfoldedLines[lastIndex] = unfoldedLines[lastIndex] + line.slice(1);
        }
      } else {
        unfoldedLines.push(line);
      }
    }

    let inEvent = false;
    for (const line of unfoldedLines) {
      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        continue;
      }
      if (line === 'END:VEVENT') {
        break;
      }
      if (!inEvent) continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const keyPart = line.slice(0, colonIndex);
      const value = line.slice(colonIndex + 1);

      // Handle properties with parameters (e.g., DTSTART;VALUE=DATE:20240101)
      const key = keyPart.split(';')[0] ?? keyPart;
      props[key] = value;
      if (keyPart.includes(';')) {
        props[`${key}_PARAMS`] = keyPart.slice(key.length + 1);
      }
    }

    const uid = props.UID ?? crypto.randomUUID();
    const isAllDay = props.DTSTART_PARAMS?.includes('VALUE=DATE') ?? false;
    const dtstart =
      props.DTSTART ?? (new Date().toISOString().replace(/[-:]/g, '').split('.')[0] ?? '') + 'Z';

    return {
      externalId: uid,
      calendarId,
      title: this.unescapeICS(props.SUMMARY ?? '(No title)'),
      description: props.DESCRIPTION ? this.unescapeICS(props.DESCRIPTION) : undefined,
      startTime: this.parseICSDate(dtstart, isAllDay),
      endTime: props.DTEND ? this.parseICSDate(props.DTEND, isAllDay) : undefined,
      isAllDay,
      location: props.LOCATION ? this.unescapeICS(props.LOCATION) : undefined,
      recurrenceRule: props.RRULE,
      status: this.mapICSStatus(props.STATUS),
      visibility: this.mapICSClass(props.CLASS),
      iCalUID: uid,
    };
  }

  /**
   * Convert event to ICS format.
   */
  private eventToICS(
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'> &
      Partial<Pick<ExternalCalendarEvent, 'externalId'>>,
    uid: string,
  ): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Athena//Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${this.formatICSDate(new Date(), false)}`,
    ];

    if (event.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${this.formatICSDate(event.startTime, true)}`);
      if (event.endTime) {
        lines.push(`DTEND;VALUE=DATE:${this.formatICSDate(event.endTime, true)}`);
      }
    } else {
      lines.push(`DTSTART:${this.formatICSDate(event.startTime, false)}`);
      if (event.endTime) {
        lines.push(`DTEND:${this.formatICSDate(event.endTime, false)}`);
      }
    }

    lines.push(`SUMMARY:${this.escapeICS(event.title)}`);

    if (event.description) {
      lines.push(`DESCRIPTION:${this.escapeICS(event.description)}`);
    }

    if (event.location) {
      lines.push(`LOCATION:${this.escapeICS(event.location)}`);
    }

    if (event.recurrenceRule) {
      // Remove RRULE: prefix if present
      const rule = event.recurrenceRule.replace(/^RRULE:/i, '');
      lines.push(`RRULE:${rule}`);
    }

    lines.push(`STATUS:${this.mapStatusToICS(event.status)}`);
    lines.push(`CLASS:${this.mapVisibilityToICS(event.visibility)}`);

    lines.push('END:VEVENT', 'END:VCALENDAR');

    return lines.join('\r\n');
  }

  private parseICSDate(value: string, isAllDay: boolean): Date {
    if (isAllDay) {
      // Format: YYYYMMDD
      const year = parseInt(value.slice(0, 4), 10);
      const month = parseInt(value.slice(4, 6), 10) - 1;
      const day = parseInt(value.slice(6, 8), 10);
      return new Date(year, month, day);
    }

    // Format: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
    const year = parseInt(value.slice(0, 4), 10);
    const month = parseInt(value.slice(4, 6), 10) - 1;
    const day = parseInt(value.slice(6, 8), 10);
    const hour = parseInt(value.slice(9, 11), 10);
    const minute = parseInt(value.slice(11, 13), 10);
    const second = parseInt(value.slice(13, 15), 10);

    if (value.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }

    return new Date(year, month, day, hour, minute, second);
  }

  private formatICSDate(date: Date, isAllDay: boolean): string {
    if (isAllDay) {
      const year = String(date.getFullYear());
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    }

    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  }

  private escapeICS(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  private unescapeICS(value: string): string {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  private mapICSStatus(status?: string): 'confirmed' | 'tentative' | 'cancelled' {
    switch (status?.toUpperCase()) {
      case 'TENTATIVE':
        return 'tentative';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'confirmed';
    }
  }

  private mapStatusToICS(status: 'confirmed' | 'tentative' | 'cancelled'): string {
    switch (status) {
      case 'tentative':
        return 'TENTATIVE';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return 'CONFIRMED';
    }
  }

  private mapICSClass(cls?: string): 'public' | 'private' | 'confidential' {
    switch (cls?.toUpperCase()) {
      case 'PRIVATE':
        return 'private';
      case 'CONFIDENTIAL':
        return 'confidential';
      default:
        return 'public';
    }
  }

  private mapVisibilityToICS(visibility: 'public' | 'private' | 'confidential'): string {
    switch (visibility) {
      case 'private':
        return 'PRIVATE';
      case 'confidential':
        return 'CONFIDENTIAL';
      default:
        return 'PUBLIC';
    }
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private normalizeColor(color: string): string {
    // iCloud colors can be in format #RRGGBBAA or #RRGGBB
    if (color.length === 9) {
      return color.slice(0, 7); // Remove alpha channel
    }
    return color;
  }

  private async fetchCtag(accessToken: string, calendarId: string): Promise<string | undefined> {
    const ctagResponse = await fetch(calendarId, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${accessToken}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <cs:getctag/>
  </d:prop>
</d:propfind>`,
    });

    if (!ctagResponse.ok) {
      return undefined;
    }

    const ctagXml = await ctagResponse.text();
    const ctagRegex = /<cs:getctag[^>]*>([^<]+)<\/cs:getctag>/;
    const ctagMatch = ctagRegex.exec(ctagXml);
    return ctagMatch?.[1];
  }
}
