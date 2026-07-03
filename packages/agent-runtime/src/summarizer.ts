/**
 * `@docket/agent-runtime` - the `Summarizer` port.
 *
 * @remarks
 * The typed edge for one-shot LLM text generation: it turns a day's worth of
 * {@link SummarizerObservation}s into the Markdown narrative of the daily digest (the
 * Sunsama-style "here's what you actually did today" email). Deliberately separate from
 * the {@link AgentTurnRuntime} port — that one streams a single agent *turn*
 * (`thought → action → response`), the wrong shape for a single non-interactive
 * completion. The real adapter calls the Anthropic Messages API; the mock returns a
 * deterministic summary so the digest pipeline runs and is asserted with no API key.
 */

/** One observation handed to the summarizer, pre-flattened by the caller. */
export interface SummarizerObservation {
  /** The source provider (e.g. `linear`). */
  readonly provider: string;
  /** The observation kind (e.g. `mention`, `assignment`, `comment`). */
  readonly kind: string;
  /** When it happened at the source (ISO-8601). */
  readonly occurredAt: string;
  /** Display title/headline. */
  readonly title: string;
  /** Optional supporting summary. */
  readonly summary?: string;
  /** Who performed the action, when known. */
  readonly actor?: string;
  /** What it was about (e.g. an issue title), when known. */
  readonly subject?: string;
}

/** Input to generate one daily digest narrative. */
export interface SummarizeInput {
  /** Human-readable label for the day being summarized (e.g. `Saturday, June 28, 2026`). */
  readonly dateLabel: string;
  /** The day's observations, in chronological order. */
  readonly observations: readonly SummarizerObservation[];
  /** The recipient's display name, when known (personalizes the narrative). */
  readonly recipientName?: string;
}

/** The generated digest narrative. */
export interface SummarizeResult {
  /** The digest as Markdown (rendered to HTML/text for delivery by the caller). */
  readonly markdown: string;
}

/**
 * The summarizer port: a single typed edge that turns observations into a digest
 * narrative. Implemented by `RealSummarizer` (Anthropic) and `MockSummarizer` (fixture).
 */
export interface Summarizer {
  /**
   * Generate the daily digest narrative for one user/day.
   *
   * @param input - The date label, observations, and optional recipient name.
   * @returns the digest Markdown.
   */
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
}
