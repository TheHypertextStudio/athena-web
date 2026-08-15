/** Mechanical event kinds that remain available to narration but do not earn a primary line. */
export const MINOR_EPISODE_KINDS: ReadonlySet<string> = new Set([
  'reaction',
  'timer_started',
  'timer_paused',
  'timer_resumed',
  'timer_switched',
  'timer_stopped',
  'agent_progress',
]);

/** Field keys whose changes are not narratively meaningful by themselves. */
export const COSMETIC_FIELD_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'label',
  'labels',
  'link',
  'links',
  'url',
  'metadata',
]);

/** Indistinguishable substantive events this close together fold into one narration fact. */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

/** The structural detail shape needed to judge a Docket field change without importing Types. */
export interface EpisodeEventDetail {
  readonly schema: string;
  readonly [key: string]: unknown;
}

/** The minimum event facts needed to create stable, low-noise daily narration episodes. */
export interface EpisodeEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly system: string;
  readonly kind: string;
  /** ISO-8601 instant the event happened at its source. */
  readonly occurredAt: string;
  readonly entityKind: string | null;
  readonly entityExternalId: string | null;
  readonly entityDocketId: string | null;
  readonly actorDocketId: string | null;
  readonly actorSource: string | null;
  readonly actorExternalId: string | null;
  readonly actorName: string | null;
  readonly detail: EpisodeEventDetail | null;
}

/** One local-day subject episode, retaining both the full and default-narration event sets. */
export interface Episode<T extends EpisodeEvent> {
  /** Stable local-day identity used to reconcile narration. */
  readonly key: string;
  /** Tenant-qualified subject identity shared by all events in this episode. */
  readonly subjectKey: string;
  /** Every event, chronologically ordered. */
  readonly allEvents: readonly T[];
  /** Substantive, non-duplicate events used for narration when available. */
  readonly visibleEvents: readonly T[];
  /** Minor activity and folded repeats retained for an all-minor story. */
  readonly relatedEvents: readonly T[];
  /** Whether the episode has no substantive event and must narrate its full activity. */
  readonly minorOnly: boolean;
}

/** Resolve the tenant-qualified subject identity one event belongs to. */
export function episodeSubjectKey(event: EpisodeEvent): string {
  if (event.entityDocketId) return `${event.organizationId}:docket:${event.entityDocketId}`;
  if (event.entityKind && event.entityExternalId) {
    return `${event.organizationId}:${event.system}:${event.entityKind}:${event.entityExternalId}`;
  }
  return `${event.organizationId}:event:${event.id}`;
}

/** Build the stable local-day key for one subject. */
export function subjectDayEpisodeKey(subjectKey: string, localDate: string): string {
  return `day:${localDate}:${subjectKey}`;
}

function fieldChangeFields(detail: EpisodeEventDetail | null): readonly string[] | null {
  if (detail?.schema !== 'docket.field_change') return null;
  const fields = detail['fields'];
  return Array.isArray(fields) && fields.every((field) => typeof field === 'string')
    ? fields
    : null;
}

/** Decide whether an event should remain a primary narration fact. */
export function isSubstantiveEpisodeEvent(event: EpisodeEvent): boolean {
  if (MINOR_EPISODE_KINDS.has(event.kind)) return false;
  if (event.kind !== 'field_change') return true;
  const fields = fieldChangeFields(event.detail);
  return !fields?.every((field) => COSMETIC_FIELD_CHANGE_FIELDS.has(field));
}

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

/** Build a stable rendered-fact fingerprint for duplicate folding. */
export function episodeEventFingerprint(event: EpisodeEvent): string {
  return JSON.stringify([
    event.actorDocketId ??
      `${event.actorSource ?? 'unknown'}:${event.actorExternalId ?? event.actorName ?? 'unknown'}`,
    event.kind,
    episodeSubjectKey(event),
    stableValue(event.detail),
  ]);
}

function chronological(left: EpisodeEvent, right: EpisodeEvent): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function finalizeEpisode<T extends EpisodeEvent>(
  key: string,
  subjectKey: string,
  events: readonly T[],
): Episode<T> {
  const visibleEvents: T[] = [];
  const relatedEvents: T[] = [];
  const seen = new Map<string, T>();

  for (const event of events) {
    if (!isSubstantiveEpisodeEvent(event)) {
      relatedEvents.push(event);
      continue;
    }
    const fingerprint = episodeEventFingerprint(event);
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
    key,
    subjectKey,
    allEvents: events,
    visibleEvents,
    relatedEvents,
    minorOnly: visibleEvents.length === 0,
  };
}

/**
 * Group one local-day episode per subject, preserving all activity while suppressing noise by
 * default. Subject identity is independent of membership so a backfilled event keeps its key.
 */
export function groupSubjectDayEpisodes<T extends EpisodeEvent>(
  events: readonly T[],
  localDate: string,
): Episode<T>[] {
  const bySubject = new Map<string, T[]>();
  for (const event of [...events].sort(chronological)) {
    const subjectKey = episodeSubjectKey(event);
    const existing = bySubject.get(subjectKey);
    if (existing) existing.push(event);
    else bySubject.set(subjectKey, [event]);
  }
  return [...bySubject].map(([subjectKey, subjectEvents]) =>
    finalizeEpisode(subjectDayEpisodeKey(subjectKey, localDate), subjectKey, subjectEvents),
  );
}
