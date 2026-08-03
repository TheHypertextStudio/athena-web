/**
 * `@docket/agent-runtime` — automatic topic segmentation of the one infinite conversation.
 *
 * @remarks
 * There is exactly one Athena conversation per person and it never ends, so "where does this
 * topic start" cannot be a control the user presses — pressing it is the thing the product is
 * trying to remove. Segmentation therefore has to be derived from the conversation itself.
 *
 * The implementation is lexical-cohesion segmentation (the TextTiling family): adjacent windows
 * of the conversation are compared by the vocabulary they share; a valley in that similarity
 * curve, deep relative to the peaks on either side, is a topic boundary. This is deterministic
 * and needs no model call, which matters for three reasons: it runs identically under the local
 * scripted runtime and in production, it costs nothing to recompute as the conversation grows,
 * and a test can assert exact boundaries.
 *
 * A model-backed segmenter can be substituted through {@link ConversationSegmenter} later
 * without any caller changing — but it must never be the only implementation, because a
 * conversation that cannot be browsed while the provider is down is not browsable.
 */

/** One message considered for segmentation. */
export interface ConversationMessage {
  /** The message's stable id (a `session_activity.id`). */
  readonly id: string;
  /** Who wrote it. */
  readonly role: 'user' | 'agent';
  /** The message's text. Empty text still occupies a position. */
  readonly text: string;
  /** When it was written. */
  readonly at: Date;
}

/** One automatically derived topic span of the conversation. */
export interface ConversationSegment {
  /** First message in the span. */
  readonly startId: string;
  /** Last message in the span. */
  readonly endId: string;
  /** When the span opened. */
  readonly startedAt: Date;
  /** When the span last had activity. */
  readonly endedAt: Date;
  /** Application-derived name for the span, taken from what the user actually asked. */
  readonly title: string;
  /** The span's most distinctive terms, for filtering and for keyword search fallbacks. */
  readonly keywords: readonly string[];
  /** How many messages the span covers. */
  readonly messageCount: number;
  /**
   * How sharp the topic change at this span's start was, 0–1.
   *
   * @remarks
   * `0` for the first span (nothing precedes it). Surfaced so a UI can render a stronger
   * divider for a hard pivot than for a drift, and so a test can assert boundary quality
   * rather than only boundary position.
   */
  readonly boundaryScore: number;
}

/** The segmentation port. */
export interface ConversationSegmenter {
  /**
   * Split a conversation into topic spans.
   *
   * @param messages - The conversation in chronological order.
   * @returns contiguous, non-overlapping spans covering every message.
   */
  segment(messages: readonly ConversationMessage[]): readonly ConversationSegment[];
}

/** Construction options for {@link LexicalCohesionSegmenter}. */
export interface LexicalCohesionSegmenterOptions {
  /** Messages compared on each side of a candidate boundary. */
  readonly window?: number;
  /** Minimum messages a span may contain, so a single aside cannot become a topic. */
  readonly minSegmentSize?: number;
  /**
   * How many standard deviations below the mean depth a valley must be to count as a boundary.
   * Lower admits more boundaries. TextTiling's own default is 0.5.
   */
  readonly depthTolerance?: number;
  /**
   * How low a valley's absolute cohesion must fall, as a fraction of the conversation's mean
   * cohesion, before it can be a boundary. Higher admits more boundaries.
   */
  readonly cohesionRatio?: number;
  /** How many keywords to keep per span. */
  readonly keywordCount?: number;
  /** Longest generated title. */
  readonly titleLength?: number;
}

/** Window size used when nothing overrides it. */
export const DEFAULT_SEGMENT_WINDOW = 2;
/** Smallest admissible span. */
export const DEFAULT_MIN_SEGMENT_SIZE = 2;
/** TextTiling's own boundary cutoff. */
export const DEFAULT_DEPTH_TOLERANCE = 0.5;
/** A boundary valley must sit below this fraction of the conversation's mean cohesion. */
export const DEFAULT_COHESION_RATIO = 0.5;
/** Longest generated segment title. */
export const SEGMENT_TITLE_MAX = 64;

/**
 * Terms carried by every conversation, which therefore say nothing about its topic.
 *
 * @remarks
 * Deliberately small and domain-neutral. A long hand-tuned list would encode this product's
 * current vocabulary into the segmenter and quietly stop working for a user who talks about
 * something else.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'for',
  'from',
  'get',
  'got',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'let',
  'like',
  'make',
  'me',
  'more',
  'most',
  'my',
  'need',
  'no',
  'not',
  'now',
  'of',
  'ok',
  'on',
  'one',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'please',
  'put',
  'really',
  'said',
  'same',
  'say',
  'see',
  'she',
  'should',
  'so',
  'some',
  'still',
  'such',
  'sure',
  'take',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'thing',
  'things',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'up',
  'us',
  'use',
  'very',
  'want',
  'was',
  'we',
  'well',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
]);

/**
 * Reduce a word to a comparison key.
 *
 * @remarks
 * A deliberately conservative suffix strip, not a full stemmer: it collapses the inflections
 * that make the same topic look like two ("newsletters"/"newsletter", "shipping"/"ship") and
 * stops there. Over-stemming would merge genuinely different topics, which is the failure that
 * actually hurts — a missed boundary is invisible, a wrong merge is not.
 *
 * @param word - A lowercased word.
 * @returns the comparison key.
 */
export function stemWord(word: string): string {
  let stem = word;
  for (const suffix of [
    'ations',
    'ation',
    'ingly',
    'edly',
    'ings',
    'ing',
    'ers',
    'er',
    'ies',
    'ied',
    'es',
    'ed',
    's',
  ]) {
    if (stem.length > suffix.length + 2 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      if (suffix === 'ies' || suffix === 'ied') stem += 'y';
      else if (suffix.startsWith('ing') || suffix === 'ed' || suffix === 'edly') {
        // English doubles a final consonant before `-ing`/`-ed` ("ship" → "shipping"). Undo it,
        // or the two spellings of one topic word never compare equal.
        /* v8 ignore next -- unreachable: the guard above required
           `stem.length > suffix.length + 2` before the slice, so post-slice `stem.length > 2`
           and `.at(-1)` is always defined; this only narrows the `string | undefined` return. */
        const last = stem.at(-1) ?? '';
        if (stem.length > 2 && last === stem.at(-2) && !'lszaeiou'.includes(last)) {
          stem = stem.slice(0, -1);
        }
      }
      break;
    }
  }
  return stem;
}

/**
 * Split text into topic-bearing stems.
 *
 * @param text - Raw message text.
 * @returns lowercased, stop-word-free stems in order of appearance.
 */
export function topicTerms(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .map(stemWord);
}

/** Count terms into a bag. */
function bagOf(messages: readonly ConversationMessage[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const message of messages) {
    for (const term of topicTerms(message.text)) bag.set(term, (bag.get(term) ?? 0) + 1);
  }
  return bag;
}

/** Cosine similarity of two term bags; `0` when either side is empty. */
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

/** Derive a span's name from the first thing the person actually asked in it. */
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
    const clipped = raw.length <= maxLength ? raw : `${raw.slice(0, maxLength - 1).trimEnd()}…`;
    return clipped;
  }
  /* v8 ignore next -- unreachable: `raw` is empty only when no message in `messages` has
     non-blank `.text.trim()` (the `opener` search above found none); `keywords` is derived from
     the same messages via `bagOf`/`topicTerms`, so an all-blank span also yields zero keywords —
     `keywords.length > 0` cannot hold whenever `raw.length` is `0`. */
  if (keywords.length > 0) return keywords.slice(0, 3).join(', ');
  return 'Untitled topic';
}

/** Pick the terms that distinguish this span from the rest of the conversation. */
function keywordsFor(
  segmentBag: Map<string, number>,
  corpusFrequency: Map<string, number>,
  segmentCount: number,
  keywordCount: number,
): readonly string[] {
  return [...segmentBag]
    .map(([term, count]) => {
      /* v8 ignore next -- unreachable: `corpusFrequency` (built by `segment()` before calling
         this) counts every term from every span's bag, including this one's `segmentBag`, so
         `term` is always already in the map. Only narrows `Map.get`'s `V | undefined` return. */
      const documentFrequency = corpusFrequency.get(term) ?? 1;
      return { term, weight: count * Math.log(1 + segmentCount / documentFrequency) };
    })
    .sort((a, b) => (b.weight === a.weight ? a.term.localeCompare(b.term) : b.weight - a.weight))
    .slice(0, keywordCount)
    .map((entry) => entry.term);
}

/** Deterministic lexical-cohesion segmentation. */
export class LexicalCohesionSegmenter implements ConversationSegmenter {
  private readonly window: number;
  private readonly minSegmentSize: number;
  private readonly depthTolerance: number;
  private readonly cohesionRatio: number;
  private readonly keywordCount: number;
  private readonly titleLength: number;

  /**
   * @param options - Window, minimum span, boundary sensitivity, and naming limits.
   */
  constructor(options: LexicalCohesionSegmenterOptions = {}) {
    this.window = Math.max(1, options.window ?? DEFAULT_SEGMENT_WINDOW);
    this.minSegmentSize = Math.max(1, options.minSegmentSize ?? DEFAULT_MIN_SEGMENT_SIZE);
    this.depthTolerance = options.depthTolerance ?? DEFAULT_DEPTH_TOLERANCE;
    this.cohesionRatio = options.cohesionRatio ?? DEFAULT_COHESION_RATIO;
    this.keywordCount = Math.max(1, options.keywordCount ?? 6);
    this.titleLength = Math.max(8, options.titleLength ?? SEGMENT_TITLE_MAX);
  }

  /**
   * Compute the cohesion score at every message gap.
   *
   * @remarks
   * Exposed because the curve is the interesting artifact: a test that only checks boundary
   * indices cannot tell a correct segmentation from a lucky one.
   *
   * @param messages - The conversation in order.
   * @returns one similarity in `[0,1]` per gap; `gap[i]` sits between message `i` and `i+1`.
   */
  cohesion(messages: readonly ConversationMessage[]): readonly number[] {
    const scores: number[] = [];
    for (let gap = 0; gap < Math.max(0, messages.length - 1); gap += 1) {
      const left = bagOf(messages.slice(Math.max(0, gap + 1 - this.window), gap + 1));
      const right = bagOf(messages.slice(gap + 1, gap + 1 + this.window));
      scores.push(cosine(left, right));
    }
    return scores;
  }

  /** {@inheritDoc ConversationSegmenter.segment} */
  segment(messages: readonly ConversationMessage[]): readonly ConversationSegment[] {
    if (messages.length === 0) return [];
    const boundaries = this.boundaryIndices(messages);
    const starts = [0, ...boundaries];
    const corpusFrequency = new Map<string, number>();
    const spans = starts.map((start, index) => {
      /* v8 ignore next -- unreachable: guarded by `index + 1 < starts.length`, so
         `starts[index + 1]` is always a valid, defined index; only narrows the
         `noUncheckedIndexedAccess` `number | undefined` element type. */
      const end =
        index + 1 < starts.length ? (starts[index + 1] ?? messages.length) : messages.length;
      return messages.slice(start, end);
    });
    for (const span of spans) {
      for (const term of new Set([...bagOf(span).keys()])) {
        corpusFrequency.set(term, (corpusFrequency.get(term) ?? 0) + 1);
      }
    }
    const depths = this.depthScores(messages);
    return spans.flatMap((span, index) => {
      const first = span[0];
      const last = span.at(-1);
      /* v8 ignore next -- unreachable: `minSegmentSize` is clamped to `Math.max(1, …)` in the
         constructor, and every boundary in `boundaryIndices()` is only pushed once both
         `start - lastStart >= minSegmentSize` and `messages.length - start >= minSegmentSize`
         hold — so every span sliced from consecutive `starts` values is non-empty. */
      if (!first || !last) return [];
      const bag = bagOf(span);
      const keywords = keywordsFor(bag, corpusFrequency, spans.length, this.keywordCount);
      /* v8 ignore next -- unreachable: `starts` and `spans` are built from the same `.map`
         call, so `index` is always a valid index into `starts`; only narrows
         `noUncheckedIndexedAccess`. */
      const startIndex = starts[index] ?? 0;
      return [
        {
          startId: first.id,
          endId: last.id,
          startedAt: first.at,
          endedAt: last.at,
          title: titleFor(span, keywords, this.titleLength),
          keywords,
          messageCount: span.length,
          /* v8 ignore next -- unreachable: for `index > 0`, `startIndex` is a boundary produced
             by `boundaryIndices()` as `gap + 1` for some `gap < depths.length`, so
             `startIndex - 1` is always a valid index into `depths`. */
          boundaryScore: index === 0 ? 0 : (depths[startIndex - 1] ?? 0),
        },
      ];
    });
  }

  /**
   * Depth score per gap: how far the valley at this gap falls below the peaks around it.
   *
   * @param messages - The conversation in order.
   * @returns one depth in `[0,2]` per gap, aligned with {@link LexicalCohesionSegmenter.cohesion}.
   */
  depthScores(messages: readonly ConversationMessage[]): readonly number[] {
    const scores = this.cohesion(messages);
    return scores.map((score, gap) => {
      let left = score;
      /* v8 ignore next -- unreachable: `index` is bounded to `[0, gap - 1]`, always a valid
         index into `scores`; only narrows `noUncheckedIndexedAccess`. */
      for (let index = gap - 1; index >= 0; index -= 1) {
        const value = scores[index] ?? 0;
        if (value < left) break;
        left = value;
      }
      let right = score;
      /* v8 ignore next -- unreachable: `index` is bounded to `[gap + 1, scores.length - 1]`,
         always a valid index into `scores`; only narrows `noUncheckedIndexedAccess`. */
      for (let index = gap + 1; index < scores.length; index += 1) {
        const value = scores[index] ?? 0;
        if (value < right) break;
        right = value;
      }
      return left - score + (right - score);
    });
  }

  /**
   * Gaps that are genuine topic changes: a deep valley AND a shallow absolute floor.
   *
   * @remarks
   * Depth alone over-segments. Inside one topic the conversation still breathes — a question
   * and its answer share less vocabulary than two consecutive statements do — and that dip is
   * a local maximum of the depth curve just like a real topic change is. What separates the two
   * is the absolute cohesion at the valley: a within-topic dip still shares most of its
   * vocabulary with both sides, while a topic change shares almost none. So a boundary must
   * clear BOTH tests — deeper than this conversation's typical valley, and lower than half its
   * typical cohesion. Requiring both is what keeps a single-topic conversation a single segment.
   */
  private boundaryIndices(messages: readonly ConversationMessage[]): readonly number[] {
    const depths = this.depthScores(messages);
    if (depths.length === 0) return [];
    const cohesion = this.cohesion(messages);
    const mean = depths.reduce((sum, value) => sum + value, 0) / depths.length;
    const variance =
      depths.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / depths.length;
    const depthCutoff = mean + this.depthTolerance * Math.sqrt(variance);
    const meanCohesion = cohesion.reduce((sum, value) => sum + value, 0) / cohesion.length;
    const cohesionCutoff = meanCohesion * this.cohesionRatio;
    const boundaries: number[] = [];
    let lastStart = 0;
    for (let gap = 0; gap < depths.length; gap += 1) {
      /* v8 ignore next -- unreachable: `gap` is bounded to `[0, depths.length - 1]`, always a
         valid index; only narrows `noUncheckedIndexedAccess`. */
      const depth = depths[gap] ?? 0;
      if (depth <= 0 || depth < depthCutoff || depthCutoff <= 0) continue;
      /* v8 ignore next -- unreachable: `cohesion` and `depths` are both derived 1:1 from
         `this.cohesion(messages)` (`depthScores` maps over it without changing length), so
         `gap < depths.length` also means `gap < cohesion.length`; only narrows
         `noUncheckedIndexedAccess`. */
      if (cohesionCutoff <= 0 || (cohesion[gap] ?? 0) >= cohesionCutoff) continue;
      const start = gap + 1;
      if (start - lastStart < this.minSegmentSize) continue;
      if (messages.length - start < this.minSegmentSize) continue;
      boundaries.push(start);
      lastStart = start;
    }
    return boundaries;
  }
}
