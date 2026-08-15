/** Public search and automatic-segmentation toolkit for Athena's durable conversation. */
export {
  DEFAULT_DEPTH_TOLERANCE,
  DEFAULT_MIN_SEGMENT_SIZE,
  DEFAULT_SEGMENT_WINDOW,
  SEGMENT_TITLE_MAX,
} from './conversation-contracts';
export type {
  ConversationMessage,
  ConversationSegment,
  ConversationSegmenter,
  LexicalCohesionSegmenterOptions,
} from './conversation-contracts';
export { LexicalCohesionSegmenter } from './conversation-segmenter';
export { stemWord, topicTerms } from './conversation-terms';
export {
  cosineSimilarity,
  matchSpans,
  searchConversation,
  withinRange,
} from './conversation-search';
export type {
  ConversationEmbedder,
  ConversationSearchHit,
  ConversationSearchOptions,
  ConversationSearchQuery,
  ConversationSearchResult,
  ConversationVectors,
  TextSpan,
} from './conversation-search';
