import { fallbackSentence } from './real-digest';
import type { NarrateDayInput, NarrateDayResult, Summarizer } from './digest-contracts';

/** Deterministic, offline daily-narration adapter for local and test runtimes. */
export class MockSummarizer implements Summarizer {
  /** Narrate every episode deterministically with the real adapter's fallback copy. */
  async narrateDay(input: NarrateDayInput): Promise<NarrateDayResult> {
    return {
      highlights: input.episodes.map((episode) => ({
        key: episode.key,
        sentence: fallbackSentence(episode),
      })),
    };
  }
}
