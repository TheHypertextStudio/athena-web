/**
 * Generic CalDAV calendar provider.
 *
 * Supports any CalDAV-compliant server including:
 * - Fastmail
 * - Nextcloud
 * - ownCloud
 * - Radicale
 * - Baïkal
 * - DAViCal
 * - Synology Calendar
 *
 * @packageDocumentation
 */

import type {
  CalendarProviderClient,
  OAuthTokens,
  SyncedCalendar,
  ExternalCalendarEvent,
  CalDAVConfig,
} from '../types.js';

/**
 * Generic CalDAV calendar provider implementation.
 *
 * CalDAV uses Basic Auth with username and password.
 * The "accessToken" is a Base64-encoded "username:password" string.
 */
export class CalDAVProvider implements CalendarProviderClient {
  readonly provider = 'caldav' as const;
  private serverUrl: string;

  constructor(config?: CalDAVConfig) {
    this.serverUrl = config?.serverUrl ?? '';
  }

  /**
   * CalDAV doesn't use OAuth. Returns a placeholder URL.
   * The application should show a custom form for server URL + credentials.
   */
  getAuthUrl(state: string): string {
    // Return a URL that the app can intercept to show credential entry form
    return `athena://caldav-auth?state=${encodeURIComponent(state)}`;
  }

  /**
   * For CalDAV, the "code" is expected to be a JSON object with:
   * - serverUrl: CalDAV server URL
   * - username: Username
   * - password: Password
   *
   * Encoded as Base64.
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    // Decode and validate credentials format
    let config: { serverUrl: string; username: string; password: string };
    try {
      const decoded = Buffer.from(code, 'base64').toString('utf-8');
      config = JSON.parse(decoded) as { serverUrl: string; username: string; password: string };
    } catch {
      throw new Error('Invalid credentials format - expected Base64-encoded JSON');
    }

    if (!config.serverUrl || !config.username || !config.password) {
      throw new Error('Credentials must include serverUrl, username, and password');
    }

    // Store server URL for later use
    this.serverUrl = config.serverUrl;

    // Create Basic Auth token
    const authToken = Buffer.from(`${config.username}:${config.password}`).toString('base64');

    // Validate credentials by making a PROPFIND request
    const response = await fetch(config.serverUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${authToken}`,
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
        throw new Error('Invalid username or password');
      }
      throw new Error(`Failed to authenticate: ${response.statusText}`);
    }

    // Store full config as access token (we need server URL for subsequent requests)
    const fullToken = Buffer.from(
      JSON.stringify({
        serverUrl: config.serverUrl,
        auth: authToken,
      }),
    ).toString('base64');

    return {
      accessToken: fullToken,
      refreshToken: fullToken, // CalDAV credentials don't expire
      tokenType: 'CalDAV',
    };
  }

  /**
   * CalDAV credentials don't expire, so just verify they're still valid.
   */
  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const { serverUrl, auth } = this.parseToken(refreshToken);

    // Verify credentials are still valid
    const response = await fetch(serverUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
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
      throw new Error('Credentials no longer valid');
    }

    return {
      accessToken: refreshToken,
      refreshToken,
      tokenType: 'CalDAV',
    };
  }

  async listCalendars(accessToken: string): Promise<SyncedCalendar[]> {
    const { serverUrl, auth } = this.parseToken(accessToken);

    // First, get the user's principal URL
    const principalUrl = await this.getUserPrincipal(serverUrl, auth);

    // Then get the calendar home URL
    const calendarHomeUrl = await this.getCalendarHome(auth, principalUrl);

    // Finally, list calendars
    const response = await fetch(calendarHomeUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:x="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <x:calendar-color/>
    <cs:getctag/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to list calendars: ${response.statusText}`);
    }

    const xml = await response.text();
    return this.parseCalendarList(xml, calendarHomeUrl, serverUrl);
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
    const { auth } = this.parseToken(accessToken);

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
        Authorization: `Basic ${auth}`,
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

    // Get sync token (ctag) for incremental sync
    const ctagResponse = await fetch(calendarId, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
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

    let nextSyncToken: string | undefined;
    if (ctagResponse.ok) {
      const ctagXml = await ctagResponse.text();
      const ctagRegex = /<cs:getctag[^>]*>([^<]+)<\/cs:getctag>/;
      const ctagMatch = ctagRegex.exec(ctagXml);
      nextSyncToken = ctagMatch?.[1];
    }

    return {
      events: options.maxResults ? events.slice(0, options.maxResults) : events,
      nextSyncToken,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: Omit<ExternalCalendarEvent, 'externalId' | 'calendarId' | 'etag'>,
  ): Promise<ExternalCalendarEvent> {
    const { auth } = this.parseToken(accessToken);
    const uid = crypto.randomUUID();
    const icsContent = this.eventToICS(event, uid);
    const eventUrl = `${calendarId.replace(/\/$/, '')}/${uid}.ics`;

    const response = await fetch(eventUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
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
    const { auth } = this.parseToken(accessToken);
    const eventUrl = `${calendarId.replace(/\/$/, '')}/${eventId}.ics`;

    // First get existing event to merge changes
    const getResponse = await fetch(eventUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
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
        Authorization: `Basic ${auth}`,
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
    const { auth } = this.parseToken(accessToken);
    const eventUrl = `${calendarId.replace(/\/$/, '')}/${eventId}.ics`;

    const response = await fetch(eventUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete event: ${response.statusText}`);
    }
  }

  private parseToken(token: string): { serverUrl: string; auth: string } {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      return JSON.parse(decoded) as { serverUrl: string; auth: string };
    } catch {
      throw new Error('Invalid access token format');
    }
  }

  private async getUserPrincipal(serverUrl: string, auth: string): Promise<string> {
    const response = await fetch(serverUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
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

    if (principalPath.startsWith('http')) {
      return principalPath;
    }

    const baseUrl = new URL(serverUrl);
    return `${baseUrl.origin}${principalPath}`;
  }

  private async getCalendarHome(auth: string, principalUrl: string): Promise<string> {
    const response = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
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

    const baseUrl = new URL(principalUrl);
    return `${baseUrl.origin}${homePath}`;
  }

  private parseCalendarList(xml: string, homeUrl: string, serverUrl: string): SyncedCalendar[] {
    const calendars: SyncedCalendar[] = [];
    const baseUrl = new URL(serverUrl);

    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;

    while ((match = responseRegex.exec(xml)) !== null) {
      const responseXml = match[1];
      if (!responseXml) continue;

      // Check if this is a calendar resource (must have calendar in resourcetype)
      if (!responseXml.includes('<c:calendar') && !responseXml.includes('<cal:calendar')) {
        continue;
      }

      // Check it supports VEVENT component
      if (
        responseXml.includes('supported-calendar-component-set') &&
        !responseXml.includes('VEVENT')
      ) {
        continue;
      }

      const hrefRegex = /<d:href>([^<]+)<\/d:href>/;
      const hrefMatch = hrefRegex.exec(responseXml);
      const href = hrefMatch?.[1];
      if (!href) continue;

      // Skip the home URL itself
      const homeUrlPath = new URL(homeUrl).pathname;
      if (href === homeUrl || href === homeUrlPath) continue;

      const nameRegex = /<d:displayname>([^<]*)<\/d:displayname>/;
      const colorRegex = /<(?:x|apple):calendar-color[^>]*>([^<]*)<\/(?:x|apple):calendar-color>/i;
      const nameMatch = nameRegex.exec(responseXml);
      const colorMatch = colorRegex.exec(responseXml);

      const calendarUrl = href.startsWith('http') ? href : `${baseUrl.origin}${href}`;
      const name = nameMatch?.[1] ?? 'Unnamed Calendar';
      const color = colorMatch?.[1];

      calendars.push({
        id: calendarUrl,
        externalId: calendarUrl,
        name: this.decodeHtmlEntities(name),
        color: color ? this.normalizeColor(color) : undefined,
        isPrimary: calendars.length === 0,
        syncEnabled: true,
        syncDirection: 'bidirectional',
      });
    }

    return calendars;
  }

  private parseEventList(xml: string, calendarId: string): ExternalCalendarEvent[] {
    const events: ExternalCalendarEvent[] = [];

    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;

    while ((match = responseRegex.exec(xml)) !== null) {
      const responseXml = match[1];
      if (!responseXml) continue;

      const etagRegex = /<d:getetag>"?([^"<]+)"?<\/d:getetag>/;
      const etagMatch = etagRegex.exec(responseXml);
      const etag = etagMatch?.[1];

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

  private parseICSEvent(ics: string, calendarId: string): ExternalCalendarEvent {
    const lines = ics.split(/\r?\n/);
    const props: Record<string, string> = {};

    // Unfold long lines
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

      const keyParts = keyPart.split(';');
      const key = keyParts[0] ?? keyPart;
      props[key] = value;
      if (keyPart.includes(';')) {
        props[`${key}_PARAMS`] = keyPart.slice(key.length + 1);
      }
    }

    const uid = props['UID'] ?? crypto.randomUUID();
    const isAllDay = props['DTSTART_PARAMS']?.includes('VALUE=DATE') ?? false;
    const defaultDtstart = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] ?? '';
    const dtstart = props['DTSTART'] ?? defaultDtstart + 'Z';

    return {
      externalId: uid,
      calendarId,
      title: this.unescapeICS(props['SUMMARY'] ?? '(No title)'),
      description: props['DESCRIPTION'] ? this.unescapeICS(props['DESCRIPTION']) : undefined,
      startTime: this.parseICSDate(dtstart, isAllDay),
      endTime: props['DTEND'] ? this.parseICSDate(props['DTEND'], isAllDay) : undefined,
      isAllDay,
      location: props['LOCATION'] ? this.unescapeICS(props['LOCATION']) : undefined,
      recurrenceRule: props['RRULE'],
      status: this.mapICSStatus(props['STATUS']),
      visibility: this.mapICSClass(props['CLASS']),
      iCalUID: uid,
    };
  }

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
      const year = parseInt(value.slice(0, 4), 10);
      const month = parseInt(value.slice(4, 6), 10) - 1;
      const day = parseInt(value.slice(6, 8), 10);
      return new Date(year, month, day);
    }

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
    if (color.length === 9) {
      return color.slice(0, 7);
    }
    return color;
  }
}
