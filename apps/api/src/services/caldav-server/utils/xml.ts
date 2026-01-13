/**
 * WebDAV XML utilities for CalDAV server.
 *
 * Builds and parses XML for WebDAV/CalDAV protocol responses.
 *
 * @packageDocumentation
 */

/**
 * XML namespaces used in CalDAV.
 */
export const NS = {
  DAV: 'DAV:',
  CALDAV: 'urn:ietf:params:xml:ns:caldav',
  CARDDAV: 'urn:ietf:params:xml:ns:carddav',
  CS: 'http://calendarserver.org/ns/',
  APPLE: 'http://apple.com/ns/ical/',
} as const;

/**
 * Property value in a multistatus response.
 */
export interface PropValue {
  [key: string]: string | PropValue | PropValue[] | undefined;
}

/**
 * Single propstat element (properties grouped by status).
 */
export interface Propstat {
  status: string;
  prop: PropValue;
}

/**
 * Single response element in a multistatus.
 */
export interface MultistatusItem {
  href: string;
  propstat: Propstat[];
}

/**
 * Build a WebDAV multistatus XML response.
 */
export function buildMultistatus(responses: MultistatusItem[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<d:multistatus xmlns:d="${NS.DAV}" xmlns:c="${NS.CALDAV}" xmlns:cs="${NS.CS}" xmlns:x="${NS.APPLE}">`,
  ];

  for (const response of responses) {
    lines.push('  <d:response>');
    lines.push(`    <d:href>${escapeXml(response.href)}</d:href>`);

    for (const propstat of response.propstat) {
      lines.push('    <d:propstat>');
      lines.push('      <d:prop>');
      lines.push(renderProp(propstat.prop, 8));
      lines.push('      </d:prop>');
      lines.push(`      <d:status>${escapeXml(propstat.status)}</d:status>`);
      lines.push('    </d:propstat>');
    }

    lines.push('  </d:response>');
  }

  lines.push('</d:multistatus>');
  return lines.join('\n');
}

/**
 * Build a simple WebDAV error response.
 */
export function buildError(errorElement: string, message?: string): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<d:error xmlns:d="${NS.DAV}" xmlns:c="${NS.CALDAV}">`,
    `  <${errorElement}/>`,
  ];

  if (message) {
    lines.push(`  <d:error-description>${escapeXml(message)}</d:error-description>`);
  }

  lines.push('</d:error>');
  return lines.join('\n');
}

/**
 * Parse requested properties from a PROPFIND request body.
 *
 * Returns array of property names or ['allprop'] if all properties requested.
 */
export function parseRequestedProperties(xml: string): string[] {
  // Check for allprop
  if (xml.includes('<d:allprop') || xml.includes('<D:allprop') || xml.includes('<allprop')) {
    return ['allprop'];
  }

  // Extract property names
  const properties: string[] = [];
  const propMatch = /<(?:d:|D:)?prop[^>]*>([\s\S]*?)<\/(?:d:|D:)?prop>/i.exec(xml);

  if (propMatch?.[1]) {
    const propContent = propMatch[1];
    // Match self-closing tags like <d:displayname/> or <displayname/>
    const tagRegex = /<([a-z]:)?([a-z-]+)(?:\s[^>]*)?\/?>/gi;
    let match;

    while ((match = tagRegex.exec(propContent)) !== null) {
      const prefix = match[1]?.replace(':', '') ?? '';
      const localName = match[2];
      if (localName) {
        // Normalize to prefixed form
        const propName = prefix ? `${prefix}:${localName}` : localName;
        properties.push(propName);
      }
    }
  }

  return properties.length > 0 ? properties : ['allprop'];
}

/**
 * Parse a sync-collection REPORT request.
 */
export function parseSyncCollection(xml: string): { syncToken: string | null } {
  const tokenMatch = /<(?:d:|D:)?sync-token[^>]*>([^<]*)<\/(?:d:|D:)?sync-token>/i.exec(xml);
  const syncToken = tokenMatch?.[1]?.trim() ?? null;

  return { syncToken };
}

/**
 * Parse a calendar-query REPORT request.
 */
export function parseCalendarQuery(xml: string): {
  timeRange?: { start?: Date; end?: Date };
} {
  const timeRangeMatch = /<c:time-range([^>]*)\/>/i.exec(xml);

  if (!timeRangeMatch) {
    return {};
  }

  const attrs = timeRangeMatch[1] ?? '';
  const startMatch = /start="([^"]+)"/.exec(attrs);
  const endMatch = /end="([^"]+)"/.exec(attrs);

  return {
    timeRange: {
      start: startMatch?.[1] ? parseICSDateString(startMatch[1]) : undefined,
      end: endMatch?.[1] ? parseICSDateString(endMatch[1]) : undefined,
    },
  };
}

/**
 * Parse a calendar-multiget REPORT request.
 */
export function parseCalendarMultiget(xml: string): { hrefs: string[] } {
  const hrefs: string[] = [];
  const hrefRegex = /<(?:d:|D:)?href>([^<]+)<\/(?:d:|D:)?href>/gi;
  let match;

  while ((match = hrefRegex.exec(xml)) !== null) {
    if (match[1]) {
      hrefs.push(decodeXml(match[1]));
    }
  }

  return { hrefs };
}

/**
 * Detect the type of REPORT request.
 */
export function detectReportType(
  xml: string,
): 'calendar-query' | 'calendar-multiget' | 'sync-collection' | 'unknown' {
  if (xml.includes('calendar-query') || xml.includes('calendar-query')) {
    return 'calendar-query';
  }
  if (xml.includes('calendar-multiget') || xml.includes('calendar-multiget')) {
    return 'calendar-multiget';
  }
  if (xml.includes('sync-collection') || xml.includes('sync-collection')) {
    return 'sync-collection';
  }
  return 'unknown';
}

/**
 * Render a property value to XML.
 *
 * Supports attributes using `@attrName` syntax in objects.
 * Example: { '@name': 'VEVENT' } becomes `<element name="VEVENT"/>`
 */
function renderProp(prop: PropValue, indent: number): string {
  const lines: string[] = [];
  const pad = ' '.repeat(indent);

  for (const [key, value] of Object.entries(prop)) {
    if (value === undefined) continue;
    // Skip attribute keys at this level (they're processed by the parent)
    if (key.startsWith('@')) continue;

    if (typeof value === 'string') {
      if (value === '') {
        lines.push(`${pad}<${key}/>`);
      } else {
        lines.push(`${pad}<${key}>${escapeXml(value)}</${key}>`);
      }
    } else if (Array.isArray(value)) {
      // Array of nested elements
      for (const item of value) {
        const attrs = extractAttributes(item);
        const hasChildren = hasNonAttributeKeys(item);

        if (attrs && !hasChildren) {
          // Self-closing with attributes: <c:comp name="VEVENT"/>
          lines.push(`${pad}<${key}${attrs}/>`);
        } else if (attrs) {
          // Element with attributes and children
          lines.push(`${pad}<${key}${attrs}>`);
          lines.push(renderProp(item, indent + 2));
          lines.push(`${pad}</${key}>`);
        } else {
          lines.push(`${pad}<${key}>`);
          lines.push(renderProp(item, indent + 2));
          lines.push(`${pad}</${key}>`);
        }
      }
    } else {
      // Nested object
      const attrs = extractAttributes(value);
      const hasChildren = hasNonAttributeKeys(value);

      if (!hasChildren && attrs) {
        // Self-closing element with attributes only
        lines.push(`${pad}<${key}${attrs}/>`);
      } else if (hasChildren) {
        if (attrs) {
          lines.push(`${pad}<${key}${attrs}>`);
        } else {
          lines.push(`${pad}<${key}>`);
        }
        lines.push(renderProp(value, indent + 2));
        lines.push(`${pad}</${key}>`);
      } else {
        lines.push(`${pad}<${key}/>`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Extract attributes (@key values) from a prop object.
 * Returns a string like ` name="value"` or empty string if no attributes.
 */
function extractAttributes(prop: PropValue): string {
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(prop)) {
    if (key.startsWith('@') && typeof value === 'string') {
      const attrName = key.slice(1); // Remove @ prefix
      attrs.push(`${attrName}="${escapeXml(value)}"`);
    }
  }
  return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
}

/**
 * Check if an object has any keys that are not attributes.
 */
function hasNonAttributeKeys(prop: PropValue): boolean {
  return Object.keys(prop).some((key) => !key.startsWith('@'));
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Decode XML entities.
 */
function decodeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Parse an iCalendar-style date string (e.g., "20260115T140000Z").
 */
function parseICSDateString(value: string): Date {
  const year = parseInt(value.slice(0, 4), 10);
  const month = parseInt(value.slice(4, 6), 10) - 1;
  const day = parseInt(value.slice(6, 8), 10);

  if (value.length === 8) {
    // Date only
    return new Date(year, month, day);
  }

  const hour = parseInt(value.slice(9, 11), 10);
  const minute = parseInt(value.slice(11, 13), 10);
  const second = parseInt(value.slice(13, 15), 10);

  if (value.endsWith('Z')) {
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  return new Date(year, month, day, hour, minute, second);
}
