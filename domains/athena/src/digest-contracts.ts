/** One source event inside a daily narration episode. */
export interface NarrationEvent {
  /** Canonical event kind, such as `completed` or `meeting_attended`. */
  readonly kind: string;
  /** When the event happened at its source, as ISO-8601. */
  readonly occurredAt: string;
  /** Display title or headline. */
  readonly title: string;
  /** Optional factual supporting detail. */
  readonly summary?: string;
  /** The actor, when known and not the recipient. */
  readonly actor?: string;
}

/** One subject's activity to describe in one first-person daily sentence. */
export interface NarrationEpisode {
  /** Caller-owned stable key echoed by the provider and used to reconcile its response. */
  readonly key: string;
  /** The source system for the episode's anchor event. */
  readonly provider: string;
  /** The human-readable subject title, when one is known. */
  readonly subject?: string;
  /** First event time in the episode, as ISO-8601. */
  readonly startedAt: string;
  /** Last event time in the episode, as ISO-8601. */
  readonly endedAt: string;
  /** Chronologically ordered facts the narrator may use. */
  readonly events: readonly NarrationEvent[];
}

/** Input to narrate one person's local day. */
export interface NarrateDayInput {
  /** Human-readable local-day label. */
  readonly dateLabel: string;
  /** Recipient display name, when known. */
  readonly recipientName?: string;
  /** Episodes in the order their highlights must be returned. */
  readonly episodes: readonly NarrationEpisode[];
}

/** One trusted sentence attached to a caller-supplied episode key. */
export interface NarratedHighlight {
  /** One of the input episode keys. */
  readonly key: string;
  /** One first-person, past-tense sentence. */
  readonly sentence: string;
}

/** Narration result reconciled to the requested episodes. */
export interface NarrateDayResult {
  /** Exactly one highlight per requested episode, in caller input order. */
  readonly highlights: readonly NarratedHighlight[];
}

/** Port for turning a day's activity episodes into reviewable trusted highlights. */
export interface Summarizer {
  /** Narrate every requested episode in a single day-level operation. */
  narrateDay(input: NarrateDayInput): Promise<NarrateDayResult>;
}
