/**
 * `@docket/agent-runtime` - `MockSummarizer`.
 *
 * @remarks
 * The offline {@link Summarizer} used in `APP_MODE ∈ {local,test}` and whenever `ANTHROPIC_API_KEY`
 * is absent. It narrates each episode deterministically from the episode's own values — no model
 * call, no clock, no randomness — so the whole pipeline (poll → group → narrate → review) runs
 * end-to-end offline and tests can assert exact output.
 *
 * It reuses {@link fallbackSentence}, which is the real adapter's own deterministic copy. That is
 * deliberate: the offline sentence is then not a second, diverging voice, and the mock exercises the
 * exact code path a real narration failure would take.
 */
import { fallbackSentence } from './real-summarizer';
import type { NarrateDayInput, NarrateDayResult, Summarizer } from './summarizer';

/** A deterministic, offline {@link Summarizer} that narrates each episode from its own events. */
export class MockSummarizer implements Summarizer {
  /** {@inheritDoc Summarizer.narrateDay} */
  async narrateDay(input: NarrateDayInput): Promise<NarrateDayResult> {
    return {
      highlights: input.episodes.map((episode) => ({
        key: episode.key,
        sentence: fallbackSentence(episode),
      })),
    };
  }
}
