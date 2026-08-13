/**
 * `@docket/types` — pure episode grouping over the canonical activity log.
 *
 * @remarks
 * An *episode* is the unit of meaning above a single `event`: six commits on one pull request,
 * or three replies on one mail thread, are one thing that happened. It is simultaneously the unit
 * of narration (one episode earns one sentence), of curation (keep/drop and rewrite act on an
 * episode), and of display (one episode is one row).
 *
 * Like `provider-catalog.ts`, this module intentionally carries no server/runtime dependencies, so
 * the API and the web app group activity through one implementation instead of two that drift.
 *
 * Two grouping strategies exist deliberately, because they answer different questions:
 *
 * - {@link groupAdjacentEpisodes} clusters *adjacent* same-subject runs no more than
 *   {@link EPISODE_GAP_MS} apart, preserving the caller's order exactly. This is presentation
 *   grouping for an unbounded, newest-first timeline, where "this morning" and "last Tuesday"
 *   must not collapse into one row.
 * - {@link groupSubjectDayEpisodes} groups *one episode per subject per local day*, regardless of
 *   adjacency. This is the strategy for a persisted, day-bounded record, and its key
 *   ({@link subjectDayEpisodeKey}) is derived from identity rather than from content.
 *
 * That second property is load-bearing rather than stylistic. An episode key is the join between
 * three things computed at different times: the server narrating a day, the row persisting the
 * narration, and the client rendering it. Activity arrives out of order — the provider searches
 * that feed the poll are eventually consistent — so a key derived from a run's membership moves
 * when a backfilled event joins that run, silently orphaning whatever a person already curated.
 * A key derived from `(subject, day)` cannot move, however much the membership churns.
 */
import type { CanonicalEntityKind, EventDetail, EventKind, SourceSystemKind } from './event';

/**
 * Adjacent same-subject events no further apart than this share one presentation episode.
 *
 * @remarks
 * Only consulted by {@link groupAdjacentEpisodes}. A day-bounded record has no use for it: the
 * question "what did I do today" wants one line per subject, not one line per working session.
 */
export const EPISODE_GAP_MS = 2 * 60 * 60 * 1000;

/** Indistinguishable events this close together fold into one visible line. */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Mechanical event families that never earn an explicit line of their own.
 *
 * @remarks
 * Membership means "disclosed rather than dropped" — a minor event stays in
 * {@link Episode.allEvents} and surfaces through {@link Episode.relatedEvents}. Unknown kinds are
 * substantive by default, so a new event kind is visible until someone decides otherwise.
 */
export const MINOR_EPISODE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'reaction',
  'timer_started',
  'timer_paused',
  'timer_resumed',
  'timer_switched',
  'timer_stopped',
  'agent_progress',
]);

/** Field keys whose changes carry no narrative weight on their own. */
export const COSMETIC_FIELD_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'label',
  'labels',
  'link',
  'links',
  'url',
  'metadata',
]);

/**
 * The minimum an event must expose to be grouped into episodes.
 *
 * @remarks
 * Structural rather than nominal on purpose: the web app's flattened row view-model and a row the
 * API selects straight out of the `event` table both satisfy it with no conversion step, so
 * neither side needs to know the other's shape.
 */
export interface EpisodeEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly system: SourceSystemKind;
  readonly kind: EventKind;
  /** ISO-8601 instant the event happened at its source. */
  readonly occurredAt: string;
  readonly entityKind: CanonicalEntityKind | null;
  readonly entityExternalId: string | null;
  readonly entityDocketId: string | null;
  readonly actorDocketId: string | null;
  readonly actorSource: SourceSystemKind | null;
  readonly actorExternalId: string | null;
  readonly actorName: string | null;
  readonly detail: EventDetail | null;
}

/** One presentation episode about a single subject. */
export interface Episode<T extends EpisodeEvent> {
  /**
   * The episode's stable identity.
   *
   * @remarks
   * From {@link subjectDayEpisodeKey} for a persisted day, and derived from the run's anchor event
   * for adjacent grouping (where it is only ever a render key). Never depends on the order the
   * caller supplied its events in.
   */
  readonly key: string;
  /** Tenant-qualified subject identity — what makes these events one story. */
  readonly subjectKey: string;
  /** Every event in the episode. Nothing is ever dropped. */
  readonly allEvents: readonly T[];
  /** Substantive, non-duplicate events shown by default. */
  readonly visibleEvents: readonly T[];
  /** Minor activity and folded repeats, available through disclosure. */
  readonly relatedEvents: readonly T[];
  /** Whether the episode has no substantive events and must be summarized to stay visible. */
  readonly minorOnly: boolean;
}

/**
 * Resolve the tenant-qualified subject identity two events must share to be one episode.
 *
 * @remarks
 * Prefers the resolved Docket entity, so the same work reached through two different tools
 * collapses into one story. Falls back to the source's own entity identity, and finally to the
 * event's own id — which keeps subject-less events separate rather than heaping them together.
 *
 * @param event - The event to key.
 * @returns the subject key.
 */
export function episodeSubjectKey(event: EpisodeEvent): string {
  if (event.entityDocketId) return `${event.organizationId}:docket:${event.entityDocketId}`;
  if (event.entityKind && event.entityExternalId) {
    return `${event.organizationId}:${event.system}:${event.entityKind}:${event.entityExternalId}`;
  }
  return `${event.organizationId}:event:${event.id}`;
}

/**
 * The persistent identity of one subject's activity on one local day.
 *
 * @remarks
 * Deliberately independent of which events happen to be known when it is computed, so late and
 * out-of-order arrivals extend an episode rather than replacing it under a new key.
 *
 * @param subjectKey - From {@link episodeSubjectKey}.
 * @param localDate - The owner's local calendar day, `YYYY-MM-DD`.
 * @returns the episode key.
 */
export function subjectDayEpisodeKey(subjectKey: string, localDate: string): string {
  return `day:${localDate}:${subjectKey}`;
}

/**
 * Decide whether an event must remain an explicit line.
 *
 * @remarks
 * Conservative in both directions: an unrecognized kind is substantive, and a field change is
 * substantive unless *every* field it touched is cosmetic. Detail that is not a Docket field
 * change cannot be judged field-by-field, so it stays visible.
 *
 * @param event - The event to classify.
 * @returns `true` when the event earns its own line.
 */
export function isSubstantiveEpisodeEvent(event: EpisodeEvent): boolean {
  if (MINOR_EPISODE_KINDS.has(event.kind)) return false;
  if (event.kind !== 'field_change') return true;
  if (event.detail?.schema !== 'docket.field_change') return true;
  return !event.detail.fields.every((field) => COSMETIC_FIELD_CHANGE_FIELDS.has(field));
}

/** Serialize a value with object keys sorted recursively, for a stable display fingerprint. */
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

/**
 * A fingerprint of everything an event would render, for defensive duplicate folding.
 *
 * @param event - The event to fingerprint.
 * @returns a stable string identifying the event's rendered appearance.
 */
export function episodeEventFingerprint(event: EpisodeEvent): string {
  return JSON.stringify([
    event.actorDocketId ??
      `${event.actorSource ?? 'unknown'}:${event.actorExternalId ?? event.actorName}`,
    event.kind,
    episodeSubjectKey(event),
    stableValue(event.detail),
  ]);
}

/**
 * Whether `candidate` sorts before `current`, with the id breaking a timestamp tie.
 *
 * @remarks
 * The tiebreak is what makes an episode key independent of the order events arrive in: two events
 * stamped the same instant would otherwise anchor an episode differently depending on which the
 * caller happened to list first.
 */
function isEarlier(candidate: EpisodeEvent, current: EpisodeEvent): boolean {
  if (candidate.occurredAt !== current.occurredAt) {
    return candidate.occurredAt < current.occurredAt;
  }
  return candidate.id < current.id;
}

/** Chronological comparator. Total, because event ids are unique. */
function chronologically(left: EpisodeEvent, right: EpisodeEvent): number {
  return isEarlier(left, right) ? -1 : 1;
}

/** Whether two events are close enough in time to share an adjacent run. */
function withinEpisodeGap(left: EpisodeEvent, right: EpisodeEvent): boolean {
  const gap = Math.abs(new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
  return gap <= EPISODE_GAP_MS;
}

/**
 * Split an episode's events into what shows by default and what hides behind disclosure.
 *
 * @remarks
 * Never reorders and never drops: `allEvents` is exactly the events handed in, and every one of
 * them appears in `visibleEvents` or `relatedEvents`.
 */
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
 * Group adjacent same-subject runs into presentation episodes, preserving the caller's order.
 *
 * @remarks
 * For an unbounded timeline. Two events join a run only when they are consecutive in the input,
 * share a subject, and are no more than {@link EPISODE_GAP_MS} apart — so a subject worked on
 * twice, hours apart, reads as two episodes. The gap comparison is absolute, so ascending and
 * descending input produce the same runs.
 *
 * @param events - Events in the caller's display order.
 * @returns the episodes, in the order their runs appeared.
 */
export function groupAdjacentEpisodes<T extends EpisodeEvent>(events: readonly T[]): Episode<T>[] {
  /**
   * `anchor` and `last` are carried alongside each run rather than looked up afterwards, so the
   * run is never indexed and there is no impossible-empty case to defend against.
   */
  const runs: { anchor: T; last: T; events: T[] }[] = [];

  for (const event of events) {
    const run = runs[runs.length - 1];
    if (
      run &&
      episodeSubjectKey(run.last) === episodeSubjectKey(event) &&
      withinEpisodeGap(run.last, event)
    ) {
      run.events.push(event);
      run.last = event;
      // The anchor is the run's chronologically-first event, so the key is the same whichever
      // direction the caller read in.
      if (isEarlier(event, run.anchor)) run.anchor = event;
      continue;
    }
    runs.push({ anchor: event, last: event, events: [event] });
  }

  return runs.map((run) =>
    finalizeEpisode(`ep:${run.anchor.id}`, episodeSubjectKey(run.anchor), run.events),
  );
}

/**
 * Group one episode per subject per local day, keyed by identity rather than by membership.
 *
 * @remarks
 * For a persisted, day-bounded record. Adjacency is deliberately ignored: a subject touched in the
 * morning and again at night is one story ("I worked on the beta twice today"), and one row whose
 * span covers both is a better answer than two rows. Events are sorted chronologically regardless
 * of the order supplied, so re-running over the same day always produces byte-identical episodes.
 *
 * @param events - The day's events, in any order.
 * @param localDate - The owner's local calendar day, `YYYY-MM-DD`.
 * @returns the episodes, ordered by when each subject was first touched.
 */
export function groupSubjectDayEpisodes<T extends EpisodeEvent>(
  events: readonly T[],
  localDate: string,
): Episode<T>[] {
  const bySubject = new Map<string, T[]>();

  for (const event of [...events].sort(chronologically)) {
    const subjectKey = episodeSubjectKey(event);
    const existing = bySubject.get(subjectKey);
    if (existing) existing.push(event);
    else bySubject.set(subjectKey, [event]);
  }

  // Insertion order is first-touched order, because the events were sorted before bucketing.
  return [...bySubject].map(([subjectKey, subjectEvents]) =>
    finalizeEpisode(subjectDayEpisodeKey(subjectKey, localDate), subjectKey, subjectEvents),
  );
}
