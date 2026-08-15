/** Public contracts and provider adapters for Athena per-episode daily narration. */
export type {
  NarrateDayInput,
  NarrateDayResult,
  NarratedHighlight,
  NarrationEpisode,
  NarrationEvent,
  Summarizer,
} from './digest-contracts';
export { MockSummarizer } from './mock-digest';
export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_SUMMARIZER_MODEL,
  RealSummarizer,
  buildRequest,
  defaultMessageCreator,
  extractText,
  fallbackSentence,
  parseHighlights,
  reconcileHighlights,
} from './real-digest';
export type { MessageCreator, RealSummarizerConfig } from './real-digest';
