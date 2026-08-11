/** One locally searchable IANA timezone presentation. */
export interface TimezoneSearchEntry {
  /** Canonical IANA identifier. */
  readonly id: string;
  /** Human city derived from the identifier's exemplar location. */
  readonly city: string;
  /** Locale-aware generic zone name. */
  readonly commonName: string;
  /** Abbreviation at the event's reference instant. */
  readonly abbreviation: string;
  /** Date-specific offset such as `UTC−7`. */
  readonly offsetLabel: string;
  /** Known standard/daylight abbreviations used only for matching. */
  readonly abbreviations: readonly string[];
  /** Normalized search corpus. */
  readonly searchText: string;
}

import { TIMEZONE_INDEX } from './timezone-index';

const INDEX_BY_ID = new Map(TIMEZONE_INDEX.map((entry) => [entry.id, entry]));

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replaceAll('_', ' ');
}

function timezoneName(
  instant: Date,
  timezone: string,
  locale: string,
  style: 'short' | 'longGeneric' | 'shortOffset',
): string {
  const part = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    timeZoneName: style,
  })
    .formatToParts(instant)
    .find((candidate) => candidate.type === 'timeZoneName');
  return part?.value ?? timezone;
}

function offsetLabel(instant: Date, timezone: string, locale: string): string {
  const raw = timezoneName(instant, timezone, locale, 'shortOffset');
  if (raw === 'GMT' || raw === 'UTC') return 'UTC';
  return raw.replace(/^GMT/, 'UTC').replace('-', '−');
}

function cityForTimezone(timezone: string): string {
  const segment = timezone.split('/').at(-1) ?? timezone;
  return segment.replaceAll('_', ' ');
}

/** Return the checked-in timezone inventory used consistently across runtimes. */
export function supportedTimezoneIds(): readonly string[] {
  return TIMEZONE_INDEX.map((entry) => entry.id);
}

/** Build date-aware, locally searchable timezone presentations. */
export function buildTimezoneSearchIndex(
  referenceInstant: string,
  locale = 'en-US',
  zoneIds: readonly string[] = supportedTimezoneIds(),
): TimezoneSearchEntry[] {
  const instant = new Date(referenceInstant);
  return zoneIds.map((id) => {
    const indexed = INDEX_BY_ID.get(id);
    const city = indexed?.city ?? cityForTimezone(id);
    const commonName = indexed?.commonName ?? id;
    const abbreviation = timezoneName(instant, id, locale, 'short');
    const abbreviations = [...new Set([abbreviation, ...(indexed?.abbreviations ?? [])])];
    return {
      id,
      city,
      commonName,
      abbreviation,
      offsetLabel: offsetLabel(instant, id, locale),
      abbreviations,
      searchText: normalize([id, city, commonName, ...abbreviations].join(' ')),
    };
  });
}

function matchRank(entry: TimezoneSearchEntry, normalizedQuery: string): number | null {
  const exactValues = [entry.id, entry.city, entry.commonName, ...entry.abbreviations].map(
    normalize,
  );
  if (normalize(entry.id) === normalizedQuery) return 0;
  if (exactValues.includes(normalizedQuery)) return 1;
  if (exactValues.some((value) => value.startsWith(normalizedQuery))) return 2;
  return entry.searchText.includes(normalizedQuery) ? 3 : null;
}

/** Rank timezone matches by exact identifier, exact human term, prefix, then substring. */
export function searchTimezones(
  entries: readonly TimezoneSearchEntry[],
  query: string,
  limit = 20,
): TimezoneSearchEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  return entries
    .map((entry) => ({ entry, rank: matchRank(entry, normalizedQuery) }))
    .filter(
      (candidate): candidate is { entry: TimezoneSearchEntry; rank: number } =>
        candidate.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.entry.city.localeCompare(right.entry.city) ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}
