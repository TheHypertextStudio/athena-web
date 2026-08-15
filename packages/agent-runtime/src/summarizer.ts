/**
 * `@docket/agent-runtime` — the `Summarizer` port.
 *
 * @remarks
 * The typed edge for one-shot LLM text generation: it turns a day's episodes into one first-person
 * sentence each — the Sunsama-style "here's what you actually did today". Deliberately separate from
 * the {@link AgentTurnRuntime} port, which streams a single agent *turn*
 * (`thought → action → response`) and is the wrong shape for a non-interactive completion. The real
 * adapter calls the Anthropic Messages API; the mock returns deterministic sentences so the whole
 * pipeline runs and is asserted with no API key.
 *
 * **Per episode, not per day.** An earlier shape returned one Markdown document for the whole day.
 * That cannot be reviewed: a person curating their highlights keeps, drops and rewrites individual
 * lines, and a single blob has no lines to address. Narrating episodes also lets a failure degrade
 * one sentence instead of the day.
 *
 * **One call, not one per episode.** Every episode goes in a single request and comes back keyed, so
 * cost stays proportional to days rather than to activity.
 */

/** One event inside an episode, flattened for the prompt. */
export interface NarrationEvent {
  /** The canonical verb (e.g. `completed`, `message`, `meeting_attended`). */
  readonly kind: string;
  /** When it happened at the source (ISO-8601). */
  readonly occurredAt: string;
  /** Display title/headline. */
  readonly title: string;
  /** Optional supporting detail. */
  readonly summary?: string | undefined;
  /** Who performed it, when known and not the person themselves. */
  readonly actor?: string | undefined;
}

/** One episode to narrate: everything that happened to one subject. */
export interface NarrationEpisode {
  /**
   * The caller's stable episode key.
   *
   * @remarks
   * Echoed back verbatim so sentences re-attach to the episodes they describe. The caller owns its
   * meaning; the summarizer treats it as an opaque label.
   */
  readonly key: string;
  /** Which tool the activity came from. */
  readonly provider: string;
  /** What it was about — an issue title, a meeting name, a thread subject. */
  readonly subject?: string | undefined;
  /** The episode's span (ISO-8601). */
  readonly startedAt: string;
  readonly endedAt: string;
  /** The substantive events, chronological. */
  readonly events: readonly NarrationEvent[];
}

/** Input to narrate one person's day. */
export interface NarrateDayInput {
  /** Human-readable label for the day (e.g. `Wednesday, August 12, 2026`). */
  readonly dateLabel: string;
  /** The recipient's display name, when known. */
  readonly recipientName?: string | undefined;
  /** The day's episodes, chronological. */
  readonly episodes: readonly NarrationEpisode[];
}

/** One narrated episode. */
export interface NarratedHighlight {
  /** Always one of the keys the caller supplied. */
  readonly key: string;
  /** One first-person, past-tense sentence. */
  readonly sentence: string;
}

/** The narrated day. */
export interface NarrateDayResult {
  /**
   * Exactly one entry per supplied episode, in the supplied order.
   *
   * @remarks
   * Guaranteed by the adapter rather than hoped for. A model that returns nothing, a subset, or
   * duplicate keys must not be able to make a day look emptier than it was — every episode gets a
   * sentence, falling back to deterministic application-owned copy where the model gave none.
   */
  readonly highlights: readonly NarratedHighlight[];
}

/**
 * The summarizer port: turn a day's episodes into one sentence each.
 *
 * @remarks
 * Implemented by `RealSummarizer` (Anthropic) and `MockSummarizer` (deterministic).
 */
export interface Summarizer {
  /**
   * Narrate every episode of one person's day.
   *
   * @param input - The day label, the recipient, and the episodes.
   * @returns one highlight per episode, in input order.
   */
  narrateDay(input: NarrateDayInput): Promise<NarrateDayResult>;
}
