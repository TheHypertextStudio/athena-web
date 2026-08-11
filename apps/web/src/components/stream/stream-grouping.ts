/**
 * `stream` — pure projection from a newest-first event sequence to chronological date sections
 * and adjacent subject episodes.
 *
 * @remarks
 * Episodes never reorder the canonical event log. Only consecutive events for the same subject,
 * in the same recency bucket and no more than two hours apart, share a presentation group. Every
 * source event remains in `allEvents`; conservative classification and duplicate folding affect
 * only which lines are initially visible.
 */
import type { StreamEventRow } from './stream-meta';

/** One presentation episode about a single subject. */
export interface StreamEpisode {
  /** Stable id derived from the newest event in the run. */
  readonly id: string;
  /** Tenant-qualified canonical or source subject identity. */
  readonly subjectKey: string;
  /** Every canonical event in unchanged server order. */
  readonly allEvents: readonly StreamEventRow[];
  /** Substantive, non-duplicate event lines shown by default. */
  readonly visibleEvents: readonly StreamEventRow[];
  /** Minor activity and folded repeats available through disclosure. */
  readonly relatedEvents: readonly StreamEventRow[];
  /** Whether the episode is represented by a generated small-activity summary. */
  readonly minorOnly: boolean;
}

/** A labelled recency section containing subject episodes. */
export interface StreamDateGroup {
  readonly label: string;
  readonly episodes: readonly StreamEpisode[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EPISODE_GAP_MS = 2 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

const MINOR_KINDS = new Set<StreamEventRow['kind']>([
  'reaction',
  'timer_started',
  'timer_paused',
  'timer_resumed',
  'timer_switched',
  'timer_stopped',
  'agent_progress',
]);

const COSMETIC_FIELDS = new Set([
  'description',
  'label',
  'labels',
  'link',
  'links',
  'url',
  'metadata',
]);

/** Midnight (local) at the start of `date`'s day. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Return the recency section key for one timestamp. */
function recencyLabel(occurredAt: string, now: Date): string {
  const time = new Date(occurredAt).getTime();
  const today = startOfDay(now);
  if (time >= today) return 'Today';
  if (time >= today - DAY_MS) return 'Yesterday';
  if (time >= today - 6 * DAY_MS) return 'Earlier this week';
  return 'Earlier';
}

/** Resolve the stable tenant-qualified subject key used for adjacent clustering. */
export function streamSubjectKey(row: StreamEventRow): string {
  if (row.entityDocketId) return `${row.organizationId}:docket:${row.entityDocketId}`;
  if (row.entityKind && row.entityExternalId) {
    return `${row.organizationId}:${row.system}:${row.entityKind}:${row.entityExternalId}`;
  }
  return `${row.organizationId}:event:${row.id}`;
}

/**
 * Decide whether a canonical event must remain an explicit line.
 *
 * @remarks
 * Unknown kinds and unknown field-change detail are substantive by default. Only the enumerated
 * mechanical event families and field changes composed entirely of cosmetic fields may collapse.
 */
export function isSubstantiveStreamEvent(row: StreamEventRow): boolean {
  if (MINOR_KINDS.has(row.kind)) return false;
  if (row.kind !== 'field_change') return true;
  if (row.detail?.schema !== 'docket.field_change') return true;
  return !row.detail.fields.every((field) => COSMETIC_FIELDS.has(field));
}

/** Serialize JSON with object keys sorted recursively for a stable display fingerprint. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

/** Presentation fingerprint for defensive duplicate folding. */
export function streamEventFingerprint(row: StreamEventRow): string {
  return JSON.stringify([
    row.actorDocketId ?? `${row.actorSource ?? 'unknown'}:${row.actorExternalId ?? row.actorName}`,
    row.kind,
    streamSubjectKey(row),
    stableValue(row.detail),
  ]);
}

/** Project one adjacent event run into visible and disclosed activity. */
function finalizeEpisode(events: readonly StreamEventRow[]): StreamEpisode {
  const first = events[0];
  if (!first) throw new Error('A Stream episode requires at least one event.');
  const visibleEvents: StreamEventRow[] = [];
  const relatedEvents: StreamEventRow[] = [];
  const seen = new Map<string, StreamEventRow>();

  for (const event of events) {
    if (!isSubstantiveStreamEvent(event)) {
      relatedEvents.push(event);
      continue;
    }
    const fingerprint = streamEventFingerprint(event);
    const prior = seen.get(fingerprint);
    if (
      prior &&
      Math.abs(new Date(prior.occurredAt).getTime() - new Date(event.occurredAt).getTime()) <=
        DUPLICATE_WINDOW_MS
    ) {
      relatedEvents.push(event);
      continue;
    }
    seen.set(fingerprint, event);
    visibleEvents.push(event);
  }

  return {
    id: first.id,
    subjectKey: streamSubjectKey(first),
    allEvents: events,
    visibleEvents,
    relatedEvents,
    minorOnly: visibleEvents.length === 0,
  };
}

/**
 * Build recency sections and adjacent subject episodes without reordering or dropping events.
 *
 * @param rows - Canonical events in server order, newest first.
 * @param now - Local reference time used for recency labels.
 */
export function buildStreamGroups(rows: readonly StreamEventRow[], now: Date): StreamDateGroup[] {
  const groups: { label: string; runs: StreamEventRow[][] }[] = [];

  for (const row of rows) {
    const label = recencyLabel(row.occurredAt, now);
    let group = groups[groups.length - 1];
    if (group?.label !== label) {
      group = { label, runs: [] };
      groups.push(group);
    }

    const run = group.runs[group.runs.length - 1];
    const preceding = run?.[run.length - 1];
    const gap = preceding
      ? Math.abs(new Date(preceding.occurredAt).getTime() - new Date(row.occurredAt).getTime())
      : Number.POSITIVE_INFINITY;
    if (
      run &&
      preceding &&
      streamSubjectKey(preceding) === streamSubjectKey(row) &&
      gap <= EPISODE_GAP_MS
    ) {
      run.push(row);
    } else {
      group.runs.push([row]);
    }
  }

  return groups.map((group) => ({
    label: group.label,
    episodes: group.runs.map(finalizeEpisode),
  }));
}

/** Compatibility adapter for consumers that still need plain date buckets. */
export function groupByRecency(
  rows: readonly StreamEventRow[],
  now: Date,
): { readonly label: string; readonly rows: readonly StreamEventRow[] }[] {
  return buildStreamGroups(rows, now).map((group) => ({
    label: group.label,
    rows: group.episodes.flatMap((episode) => episode.allEvents),
  }));
}
