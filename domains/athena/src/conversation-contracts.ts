/** One durable conversation message considered by Athena's browsing tools. */
export interface ConversationMessage {
  /** Stable durable activity identifier. */
  readonly id: string;
  /** Person or Athena authored role. */
  readonly role: 'user' | 'agent';
  /** Text content; an empty message still occupies its original position. */
  readonly text: string;
  /** Message timestamp. */
  readonly at: Date;
}

/** One automatic topic span in a continuous Athena conversation. */
export interface ConversationSegment {
  /** First message id in the span. */
  readonly startId: string;
  /** Last message id in the span. */
  readonly endId: string;
  /** Timestamp of the first message. */
  readonly startedAt: Date;
  /** Timestamp of the final message. */
  readonly endedAt: Date;
  /** Derived, readable topic name. */
  readonly title: string;
  /** Distinctive terms useful for browsing or fallback filtering. */
  readonly keywords: readonly string[];
  /** Number of contiguous messages in the span. */
  readonly messageCount: number;
  /** Strength of the topic change that opened this span; zero for the first span. */
  readonly boundaryScore: number;
}

/** Adapter boundary for alternate conversation segmenters. */
export interface ConversationSegmenter {
  /** Split messages into contiguous, non-overlapping spans. */
  segment(messages: readonly ConversationMessage[]): readonly ConversationSegment[];
}

/** Construction options for the deterministic lexical-cohesion segmenter. */
export interface LexicalCohesionSegmenterOptions {
  /** Number of messages compared on either side of a candidate boundary. */
  readonly window?: number;
  /** Minimum number of messages in an accepted topic span. */
  readonly minSegmentSize?: number;
  /** Standard-deviation sensitivity for a cohesion valley. */
  readonly depthTolerance?: number;
  /** Absolute cohesion-ratio sensitivity for a cohesion valley. */
  readonly cohesionRatio?: number;
  /** Number of distinctive terms retained for one topic. */
  readonly keywordCount?: number;
  /** Maximum generated topic-title length. */
  readonly titleLength?: number;
}

/** Default window on each side of a candidate message gap. */
export const DEFAULT_SEGMENT_WINDOW = 2;
/** Smallest allowed topic span. */
export const DEFAULT_MIN_SEGMENT_SIZE = 2;
/** TextTiling-inspired standard-deviation cutoff. */
export const DEFAULT_DEPTH_TOLERANCE = 0.5;
/** A boundary valley must stay below this fraction of mean cohesion. */
export const DEFAULT_COHESION_RATIO = 0.5;
/** Maximum generated topic-title length. */
export const SEGMENT_TITLE_MAX = 64;
