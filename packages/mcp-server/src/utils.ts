export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
};

export const parseDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export const parseIsoDateParts = (value: string): DateParts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const getRequiredDatePart = (parts: Record<string, string>, key: string): string => {
  const value = parts[key];
  if (!value) {
    throw new Error(`Missing date part: ${key}`);
  }
  return value;
};

export const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = getRequiredDatePart(lookup, 'year');
  const month = getRequiredDatePart(lookup, 'month');
  const day = getRequiredDatePart(lookup, 'day');
  return `${year}-${month}-${day}`;
};

const getTimeZoneOffset = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(getRequiredDatePart(lookup, 'year')),
    Number(getRequiredDatePart(lookup, 'month')) - 1,
    Number(getRequiredDatePart(lookup, 'day')),
    Number(getRequiredDatePart(lookup, 'hour')),
    Number(getRequiredDatePart(lookup, 'minute')),
    Number(getRequiredDatePart(lookup, 'second')),
  );
  return asUtc - date.getTime();
};

export const getStartOfDayInTimeZone = (parts: DateParts, timeZone: string): Date => {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offsetMs = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offsetMs);
};

export const addDaysToParts = (parts: DateParts, days: number): DateParts => {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
};

export const getStringField = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' ? value : null;
};

export const getBooleanField = (record: Record<string, unknown>, key: string): boolean | null => {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
};

export const getVariableValue = (
  variables: Record<string, string | string[]>,
  key: string,
): string | null => {
  const value = variables[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
};

export const stringifyJson = (uri: string, data: unknown) => ({
  contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
});

const encodeCursor = (date: Date, id: string): string =>
  Buffer.from(JSON.stringify({ date: date.toISOString(), id }), 'utf8').toString('base64url');

export const decodeCursor = (
  cursor: string | undefined | null,
): { date: Date; id: string } | null => {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const payload = asRecord(JSON.parse(decoded) as unknown);
    if (!payload) {
      return null;
    }
    const dateValue = getStringField(payload, 'date');
    const id = getStringField(payload, 'id');
    const date = dateValue ? parseDate(dateValue) : null;
    if (!date || !id) {
      return null;
    }
    return { date, id };
  } catch {
    return null;
  }
};

const buildCursorFromItem = (
  item: unknown,
  dateField: string,
  idField: string,
): string | undefined => {
  const record = asRecord(item);
  if (!record) {
    return undefined;
  }
  const dateValue = parseDate(record[dateField]);
  const id = getStringField(record, idField);
  if (!dateValue || !id) {
    return undefined;
  }
  return encodeCursor(dateValue, id);
};

export const buildCursorPage = <T>(
  items: T[],
  limit: number,
  dateField: string,
  idField: string,
) => {
  const hasNext = items.length > limit;
  const pageItems = hasNext ? items.slice(0, limit) : items;
  const lastItem = pageItems[pageItems.length - 1];
  const nextCursor = hasNext ? buildCursorFromItem(lastItem, dateField, idField) : undefined;
  return { items: pageItems, nextCursor };
};
