import {
  DEFAULT_COHESION_RATIO,
  DEFAULT_DEPTH_TOLERANCE,
  DEFAULT_MIN_SEGMENT_SIZE,
  DEFAULT_SEGMENT_WINDOW,
  SEGMENT_TITLE_MAX,
  type ConversationMessage,
  type ConversationSegment,
  type ConversationSegmenter,
  type LexicalCohesionSegmenterOptions,
} from './conversation-contracts';
import { topicTerms } from './conversation-terms';

function bagOf(messages: readonly ConversationMessage[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const message of messages) {
    for (const term of topicTerms(message.text)) bag.set(term, (bag.get(term) ?? 0) + 1);
  }
  return bag;
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  if (leftNorm === 0 || rightNorm === 0) return 0;
  for (const [term, value] of left) {
    const other = right.get(term);
    if (other !== undefined) dot += value * other;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function titleFor(
  messages: readonly ConversationMessage[],
  keywords: readonly string[],
  maxLength: number,
): string {
  const opener =
    messages.find((message) => message.role === 'user' && message.text.trim()) ??
    messages.find((message) => message.text.trim());
  const raw = opener?.text.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (raw.length > 0) {
    return raw.length <= maxLength ? raw : `${raw.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return keywords.length > 0 ? keywords.slice(0, 3).join(', ') : 'Untitled topic';
}

function keywordsFor(
  segmentBag: Map<string, number>,
  corpusFrequency: Map<string, number>,
  segmentCount: number,
  keywordCount: number,
): readonly string[] {
  return [...segmentBag]
    .map(([term, count]) => {
      const documentFrequency = corpusFrequency.get(term) ?? 1;
      return { term, weight: count * Math.log(1 + segmentCount / documentFrequency) };
    })
    .sort((left, right) =>
      right.weight === left.weight
        ? left.term.localeCompare(right.term)
        : right.weight - left.weight,
    )
    .slice(0, keywordCount)
    .map((entry) => entry.term);
}

/**
 * Deterministic TextTiling-style segmentation for Athena's long-running conversation.
 *
 * It compares adjacent lexical windows and recognizes only deep, low-cohesion valleys as topic
 * boundaries. That gives users useful browseable spans without requiring a model call.
 */
export class LexicalCohesionSegmenter implements ConversationSegmenter {
  private readonly window: number;
  private readonly minSegmentSize: number;
  private readonly depthTolerance: number;
  private readonly cohesionRatio: number;
  private readonly keywordCount: number;
  private readonly titleLength: number;

  constructor(options: LexicalCohesionSegmenterOptions = {}) {
    this.window = Math.max(1, options.window ?? DEFAULT_SEGMENT_WINDOW);
    this.minSegmentSize = Math.max(1, options.minSegmentSize ?? DEFAULT_MIN_SEGMENT_SIZE);
    this.depthTolerance = options.depthTolerance ?? DEFAULT_DEPTH_TOLERANCE;
    this.cohesionRatio = options.cohesionRatio ?? DEFAULT_COHESION_RATIO;
    this.keywordCount = Math.max(1, options.keywordCount ?? 6);
    this.titleLength = Math.max(8, options.titleLength ?? SEGMENT_TITLE_MAX);
  }

  /** Return one lexical-cohesion score for every gap between adjacent messages. */
  cohesion(messages: readonly ConversationMessage[]): readonly number[] {
    const scores: number[] = [];
    for (let gap = 0; gap < Math.max(0, messages.length - 1); gap += 1) {
      const left = bagOf(messages.slice(Math.max(0, gap + 1 - this.window), gap + 1));
      const right = bagOf(messages.slice(gap + 1, gap + 1 + this.window));
      scores.push(cosine(left, right));
    }
    return scores;
  }

  /** Split messages into derived, contiguous topic spans. */
  segment(messages: readonly ConversationMessage[]): readonly ConversationSegment[] {
    if (messages.length === 0) return [];
    const starts = [0, ...this.boundaryIndices(messages)];
    const spans = starts.map((start, index) => {
      const end =
        index + 1 < starts.length ? (starts[index + 1] ?? messages.length) : messages.length;
      return messages.slice(start, end);
    });
    const corpusFrequency = new Map<string, number>();
    for (const span of spans) {
      for (const term of new Set(bagOf(span).keys())) {
        corpusFrequency.set(term, (corpusFrequency.get(term) ?? 0) + 1);
      }
    }
    const depths = this.depthScores(messages);
    return spans.flatMap((span, index) => {
      const first = span[0];
      const last = span.at(-1);
      if (!first || !last) return [];
      const keywords = keywordsFor(bagOf(span), corpusFrequency, spans.length, this.keywordCount);
      const start = starts[index] ?? 0;
      return [
        {
          startId: first.id,
          endId: last.id,
          startedAt: first.at,
          endedAt: last.at,
          title: titleFor(span, keywords, this.titleLength),
          keywords,
          messageCount: span.length,
          boundaryScore: index === 0 ? 0 : (depths[start - 1] ?? 0),
        },
      ];
    });
  }

  /** Return each gap's valley depth relative to the nearest cohesion peaks on both sides. */
  depthScores(messages: readonly ConversationMessage[]): readonly number[] {
    const scores = this.cohesion(messages);
    return scores.map((score, gap) => {
      let leftPeak = score;
      for (let index = gap - 1; index >= 0; index -= 1) {
        const value = scores[index] ?? 0;
        if (value < leftPeak) break;
        leftPeak = value;
      }
      let rightPeak = score;
      for (let index = gap + 1; index < scores.length; index += 1) {
        const value = scores[index] ?? 0;
        if (value < rightPeak) break;
        rightPeak = value;
      }
      return leftPeak - score + (rightPeak - score);
    });
  }

  private boundaryIndices(messages: readonly ConversationMessage[]): readonly number[] {
    const depths = this.depthScores(messages);
    if (depths.length === 0) return [];
    const cohesion = this.cohesion(messages);
    const meanDepth = depths.reduce((sum, value) => sum + value, 0) / depths.length;
    const variance =
      depths.reduce((sum, value) => sum + (value - meanDepth) * (value - meanDepth), 0) /
      depths.length;
    const depthCutoff = meanDepth + this.depthTolerance * Math.sqrt(variance);
    const meanCohesion = cohesion.reduce((sum, value) => sum + value, 0) / cohesion.length;
    const cohesionCutoff = meanCohesion * this.cohesionRatio;
    const boundaries: number[] = [];
    let lastStart = 0;
    for (let gap = 0; gap < depths.length; gap += 1) {
      const depth = depths[gap] ?? 0;
      if (depth <= 0 || depth < depthCutoff || depthCutoff <= 0) continue;
      if (cohesionCutoff <= 0 || (cohesion[gap] ?? 0) >= cohesionCutoff) continue;
      const start = gap + 1;
      if (
        start - lastStart < this.minSegmentSize ||
        messages.length - start < this.minSegmentSize
      ) {
        continue;
      }
      boundaries.push(start);
      lastStart = start;
    }
    return boundaries;
  }
}
