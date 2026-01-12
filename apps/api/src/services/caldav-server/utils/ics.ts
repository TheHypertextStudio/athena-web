/**
 * iCalendar (RFC 5545) utilities for CalDAV server.
 *
 * Provides parsing and generation of iCalendar (.ics) files.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';

/**
 * Parsed iCalendar event data.
 */
export interface ICSEvent {
  uid: string;
  summary: string;
  description?: string;
  dtstart: Date;
  dtend?: Date;
  isAllDay: boolean;
  location?: string;
  rrule?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  transp?: 'OPAQUE' | 'TRANSPARENT';
  class?: 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL';
  sequence?: number;
  organizer?: string;
  attendees?: ICSAttendee[];
}

/**
 * iCalendar attendee.
 */
export interface ICSAttendee {
  email: string;
  name?: string;
  partstat?: 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
  role?: 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'NON-PARTICIPANT' | 'CHAIR';
}

/**
 * Parse an iCalendar (.ics) file into event data.
 */
export function parseICS(ics: string): ICSEvent {
  const lines = ics.split(/\r?\n/);
  const props: Record<string, string> = {};

  // Unfold long lines (RFC 5545 section 3.1)
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
  const attendees: ICSAttendee[] = [];

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

    // Store parameters separately
    if (keyPart.includes(';')) {
      props[`${key}_PARAMS`] = keyPart.slice(key.length + 1);
    }

    // Handle ATTENDEE specially
    if (key === 'ATTENDEE') {
      const attendee = parseAttendee(keyPart, value);
      if (attendee) {
        attendees.push(attendee);
      }
    }
  }

  const uid = props.UID ?? crypto.randomUUID();
  const isAllDay = props.DTSTART_PARAMS?.includes('VALUE=DATE') ?? false;
  const defaultDtstart = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] ?? '';
  const dtstart = props.DTSTART ?? defaultDtstart + 'Z';

  return {
    uid,
    summary: unescapeICS(props.SUMMARY ?? '(No title)'),
    description: props.DESCRIPTION ? unescapeICS(props.DESCRIPTION) : undefined,
    dtstart: parseICSDate(dtstart, isAllDay),
    dtend: props.DTEND ? parseICSDate(props.DTEND, isAllDay) : undefined,
    isAllDay,
    location: props.LOCATION ? unescapeICS(props.LOCATION) : undefined,
    rrule: props.RRULE,
    status: mapICSStatus(props.STATUS),
    transp: mapICSTransp(props.TRANSP),
    class: mapICSClass(props.CLASS),
    sequence: props.SEQUENCE ? parseInt(props.SEQUENCE, 10) : 0,
    organizer: props.ORGANIZER ? extractEmail(props.ORGANIZER) : undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
  };
}

/**
 * Generate an iCalendar (.ics) file from event data.
 */
export function generateICS(event: ICSEvent): string {
  const sequenceValue = event.sequence ?? 0;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Athena//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatICSDate(new Date(), false)}`,
    `SEQUENCE:${String(sequenceValue)}`,
  ];

  // Date/time
  if (event.isAllDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatICSDate(event.dtstart, true)}`);
    if (event.dtend) {
      lines.push(`DTEND;VALUE=DATE:${formatICSDate(event.dtend, true)}`);
    }
  } else {
    lines.push(`DTSTART:${formatICSDate(event.dtstart, false)}`);
    if (event.dtend) {
      lines.push(`DTEND:${formatICSDate(event.dtend, false)}`);
    }
  }

  // Required: SUMMARY
  lines.push(`SUMMARY:${escapeICS(event.summary)}`);

  // Optional properties
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICS(event.location)}`);
  }

  if (event.rrule) {
    const rule = event.rrule.replace(/^RRULE:/i, '');
    lines.push(`RRULE:${rule}`);
  }

  lines.push(`STATUS:${event.status ?? 'CONFIRMED'}`);
  lines.push(`TRANSP:${event.transp ?? 'OPAQUE'}`);
  lines.push(`CLASS:${event.class ?? 'PUBLIC'}`);

  // Organizer
  if (event.organizer) {
    lines.push(`ORGANIZER:mailto:${event.organizer}`);
  }

  // Attendees
  if (event.attendees) {
    for (const attendee of event.attendees) {
      const params: string[] = [];
      if (attendee.name) {
        params.push(`CN=${escapeICS(attendee.name)}`);
      }
      if (attendee.partstat) {
        params.push(`PARTSTAT=${attendee.partstat}`);
      }
      if (attendee.role) {
        params.push(`ROLE=${attendee.role}`);
      }
      const paramStr = params.length > 0 ? `;${params.join(';')}` : '';
      lines.push(`ATTENDEE${paramStr}:mailto:${attendee.email}`);
    }
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  // Fold long lines (RFC 5545 requires lines <= 75 octets)
  return foldLines(lines.join('\r\n'));
}

/**
 * Parse an iCalendar date/time string.
 */
export function parseICSDate(value: string, isAllDay: boolean): Date {
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

/**
 * Format a Date to iCalendar format.
 */
export function formatICSDate(date: Date, isAllDay: boolean): string {
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

/**
 * Escape special characters in iCalendar text values.
 */
export function escapeICS(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Unescape iCalendar text values.
 */
export function unescapeICS(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Fold lines to comply with RFC 5545 line length requirements.
 * Lines must not exceed 75 octets (bytes).
 */
function foldLines(content: string): string {
  const lines = content.split('\r\n');
  const foldedLines: string[] = [];

  for (const line of lines) {
    if (Buffer.byteLength(line, 'utf-8') <= 75) {
      foldedLines.push(line);
    } else {
      // Fold line at 75 byte boundary
      let remaining = line;
      let isFirst = true;
      while (Buffer.byteLength(remaining, 'utf-8') > 75) {
        // Find byte position to cut at
        let cutPoint = 75;
        if (!isFirst) {
          cutPoint = 74; // Account for leading space
        }

        // Find character boundary (don't split multi-byte chars)
        while (
          cutPoint > 0 &&
          Buffer.byteLength(remaining.slice(0, cutPoint), 'utf-8') > (isFirst ? 75 : 74)
        ) {
          cutPoint--;
        }

        foldedLines.push((isFirst ? '' : ' ') + remaining.slice(0, cutPoint));
        remaining = remaining.slice(cutPoint);
        isFirst = false;
      }
      if (remaining) {
        foldedLines.push(' ' + remaining);
      }
    }
  }

  return foldedLines.join('\r\n');
}

function parseAttendee(keyPart: string, value: string): ICSAttendee | null {
  const email = extractEmail(value);
  if (!email) return null;

  const params = keyPart.split(';').slice(1);
  const attendee: ICSAttendee = { email };

  for (const param of params) {
    const [key, val] = param.split('=');
    if (!key || !val) continue;

    switch (key.toUpperCase()) {
      case 'CN':
        attendee.name = unescapeICS(val);
        break;
      case 'PARTSTAT':
        attendee.partstat = val.toUpperCase() as ICSAttendee['partstat'];
        break;
      case 'ROLE':
        attendee.role = val.toUpperCase() as ICSAttendee['role'];
        break;
    }
  }

  return attendee;
}

function extractEmail(value: string): string | undefined {
  const match = /mailto:([^?]+)/i.exec(value);
  return match?.[1];
}

function mapICSStatus(status?: string): ICSEvent['status'] {
  switch (status?.toUpperCase()) {
    case 'TENTATIVE':
      return 'TENTATIVE';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'CONFIRMED';
  }
}

function mapICSTransp(transp?: string): ICSEvent['transp'] {
  switch (transp?.toUpperCase()) {
    case 'TRANSPARENT':
      return 'TRANSPARENT';
    default:
      return 'OPAQUE';
  }
}

function mapICSClass(cls?: string): ICSEvent['class'] {
  switch (cls?.toUpperCase()) {
    case 'PRIVATE':
      return 'PRIVATE';
    case 'CONFIDENTIAL':
      return 'CONFIDENTIAL';
    default:
      return 'PUBLIC';
  }
}
