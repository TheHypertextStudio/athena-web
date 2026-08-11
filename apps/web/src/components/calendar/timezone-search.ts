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

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

const TIMEZONE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'America/Los_Angeles': ['PST', 'PDT', 'Pacific Time'],
  'America/Vancouver': ['PST', 'PDT', 'Pacific Time'],
  'America/Denver': ['MST', 'MDT', 'Mountain Time'],
  'America/Chicago': ['CST', 'CDT', 'Central Time'],
  'America/New_York': ['EST', 'EDT', 'Eastern Time'],
  'Pacific/Pitcairn': ['PST', 'Pitcairn Time'],
};

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

/** Return the runtime timezone inventory, with a small compatibility fallback. */
export function supportedTimezoneIds(): readonly string[] {
  const supportedValuesOf = Intl.supportedValuesOf;
  return typeof supportedValuesOf === 'function'
    ? supportedValuesOf('timeZone')
    : FALLBACK_TIMEZONES;
}

/** Build date-aware, locally searchable timezone presentations. */
export function buildTimezoneSearchIndex(
  referenceInstant: string,
  locale = 'en-US',
  zoneIds: readonly string[] = supportedTimezoneIds(),
): TimezoneSearchEntry[] {
  const instant = new Date(referenceInstant);
  const year = instant.getUTCFullYear();
  const seasonalInstants = [
    instant,
    new Date(Date.UTC(year, 0, 15)),
    new Date(Date.UTC(year, 6, 15)),
  ];

  return zoneIds.map((id) => {
    const city = cityForTimezone(id);
    const commonName = timezoneName(instant, id, locale, 'longGeneric');
    const abbreviation = timezoneName(instant, id, locale, 'short');
    const abbreviations = [
      ...new Set([
        abbreviation,
        ...seasonalInstants.map((date) => timezoneName(date, id, locale, 'short')),
        ...(TIMEZONE_ALIASES[id] ?? []),
      ]),
    ];
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
