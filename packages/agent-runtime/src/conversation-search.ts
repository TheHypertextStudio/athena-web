/**
 * `@docket/agent-runtime` — retrieval over the one infinite Athena conversation.
 *
 * @remarks
 * Browsing an endless conversation by scrolling is not browsing. Three access paths make it
 * navigable, and they compose: an exact keyword lookup, a meaning-level lookup, and a date
 * range. All three are computed here as pure functions over messages so they behave identically
 * whether the caller is a route, a test, or a client-side filter.
 *
 * Two deliberate properties:
 *
 * - **Keyword search is exhaustive, not ranked-lossy.** A term query returns every message
 *   containing the term and nothing else, with the matched spans reported so the caller can
 *   highlight them. Ranking then orders that set; it never trims it. A search that silently
 *   drops a match teaches people not to trust search.
 * - **Meaning-level search degrades honestly.** {@link ConversationEmbedder} is a port. When one
 *   is supplied, hits are ranked by vector similarity blended with the lexical score. When none
 *   is supplied, {@link searchConversation} reports `semantic: false` on its result rather than
 *   pretending a lexical match is a semantic one.
 */
import { topicTerms } from './conversation-segmenter';
import type { ConversationMessage } from './conversation-segmenter';

export type { ConversationMessage };

/** A half-open character range inside a message's text. */
export interface TextSpan {
  /** Inclusive start index. */
  readonly start: number;
  /** Exclusive end index. */
  readonly end: number;
}

/** One matched message. */
export interface ConversationSearchHit {
  /** The matched message. */
  readonly message: ConversationMessage;
  /** Relevance, higher is better. */
  readonly score: number;
  /** Character ranges in `message.text` that matched a query term, in order. */
  readonly highlights: readonly TextSpan[];
  /** True when the message contains at least one query term literally. */
  readonly lexical: boolean;
}

/** A conversation query. Every field is optional and they compose conjunctively. */
export interface ConversationSearchQuery {
  /** Free text. Empty or absent means "no term constraint". */
  readonly text?: string;
  /** Inclusive lower bound. */
  readonly from?: Date;
  /** Inclusive upper bound. */
  readonly to?: Date;
}

/** Options for {@link searchConversation}. */
export interface ConversationSearchOptions {
  /** Cap on returned hits. Omit for all matches. */
  readonly limit?: number;
  /** Precomputed query vector, and per-message vectors, for meaning-level ranking. */
  readonly vectors?: ConversationVectors;
}

/** Vector inputs for meaning-level ranking. */
export interface ConversationVectors {
  /** The query's embedding. */
  readonly query: readonly number[];
  /** message id → that message's embedding. */
  readonly byMessageId: ReadonlyMap<string, readonly number[]>;
}

/** The outcome of one search. */
export interface ConversationSearchResult {
  /** Matching messages, best first. */
  readonly hits: readonly ConversationSearchHit[];
  /** How many messages matched before `limit` was applied. */
  readonly total: number;
  /** True when meaning-level ranking actually ran (vectors were supplied). */
  readonly semantic: boolean;
  /** The query terms after normalization; empty for a date-only query. */
  readonly terms: readonly string[];
}

/** The embedding port used for meaning-level retrieval. */
export interface ConversationEmbedder {
  /**
   * Embed one batch of texts.
   *
   * @param texts - The texts to embed, in order.
   * @returns one vector per input, in the same order and of the same dimension.
   */
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/** BM25 term-frequency saturation. */
const BM25_K1 = 1.2;
/** BM25 length normalization. */
const BM25_B = 0.75;
/** How much a vector match can contribute relative to the lexical score. */
const SEMANTIC_WEIGHT = 2;

/** Lowercase, strip accents-free punctuation, and split into raw words for literal matching. */
function literalWords(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Find every literal occurrence of any query word in a message.
 *
 * @remarks
 * Matching is on whole words, case-insensitively, against the raw text — not against stems — so
 * the reported spans line up exactly with what the reader sees. Stemming is used for ranking,
 * never for deciding what to highlight.
 *
 * @param text - The message text.
 * @param words - Lowercased query words.
 * @returns non-overlapping ranges in order.
 */
export function matchSpans(text: string, words: readonly string[]): readonly TextSpan[] {
  if (words.length === 0) return [];
  const wanted = new Set(words);
  const spans: TextSpan[] = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  let match = pattern.exec(text);
  while (match) {
    if (wanted.has(match[0].toLowerCase())) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
    match = pattern.exec(text);
  }
  return spans;
}

/** Cosine similarity of two equal-length vectors; `0` when either is degenerate. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    /* v8 ignore start -- unreachable: `length` is `Math.min(left.length, right.length)`, so
       `index` is always a valid index into both arrays; this only narrows the
       `noUncheckedIndexedAccess` `number | undefined` element type. */
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    /* v8 ignore stop */
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * True when an instant falls inside an inclusive date range.
 *
 * @remarks
 * Both bounds are inclusive of the whole boundary day. The caller supplies bounds already
 * expressed in the workspace's timezone (a route resolves the workspace's zone before calling),
 * so this function does no timezone arithmetic of its own — one place to get zones wrong is
 * better than two.
 *
 * @param at - The instant to test.
 * @param from - Inclusive lower bound, or omitted.
 * @param to - Inclusive upper bound, or omitted.
 */
export function withinRange(at: Date, from?: Date, to?: Date): boolean {
  const time = at.getTime();
  if (from && time < from.getTime()) return false;
  if (to && time > to.getTime()) return false;
  return true;
}

/**
 * Search a conversation.
 *
 * @remarks
 * The term constraint is exhaustive: every message containing a query word is a hit, and no
 * message without one is — unless vectors are supplied, in which case a message that is
 * semantically close is admitted as well and marked `lexical: false`, so a caller can tell the
 * two apart.
 *
 * @param messages - The conversation, any order.
 * @param query - Term and/or date constraints.
 * @param options - Limit and optional vectors.
 * @returns hits best-first, plus what the search actually did.
 */
export function searchConversation(
  messages: readonly ConversationMessage[],
  query: ConversationSearchQuery,
  options: ConversationSearchOptions = {},
): ConversationSearchResult {
  const inRange = messages.filter((message) => withinRange(message.at, query.from, query.to));
  const words = literalWords(query.text ?? '');
  const terms = topicTerms(query.text ?? '');
  const vectors = options.vectors;

  if (words.length === 0) {
    const hits = [...inRange]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((message) => ({ message, score: 0, highlights: [], lexical: false }));
    return {
      hits: options.limit === undefined ? hits : hits.slice(0, options.limit),
      total: hits.length,
      semantic: false,
      terms,
    };
  }

  // BM25 statistics over the date-filtered slice, so a narrowed range ranks against itself.
  const documents = inRange.map((message) => ({ message, terms: topicTerms(message.text) }));
  const averageLength =
    documents.reduce((sum, document) => sum + document.terms.length, 0) /
    Math.max(1, documents.length);
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(document.terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const scored = documents.flatMap((document) => {
    const highlights = matchSpans(document.message.text, words);
    let lexicalScore = 0;
    for (const term of new Set(terms)) {
      const frequency = document.terms.filter((candidate) => candidate === term).length;
      if (frequency === 0) continue;
      /* v8 ignore next -- unreachable: `documentFrequency` was built above from every document's
         terms, and `term` is only reached here once `frequency > 0` proves it is in THIS
         document's terms — so it is always already in the map. Only narrows `Map.get`'s
         `V | undefined` return type. */
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const denominator =
        frequency + BM25_K1 * (1 - BM25_B + (BM25_B * document.terms.length) / averageLength);
      lexicalScore += idf * ((frequency * (BM25_K1 + 1)) / denominator);
    }
    const vector = vectors?.byMessageId.get(document.message.id);
    const similarity = vectors && vector ? cosineSimilarity(vectors.query, vector) : 0;
    const lexical = highlights.length > 0 || lexicalScore > 0;
    if (!lexical && similarity <= 0) return [];
    return [
      {
        message: document.message,
        score: lexicalScore + similarity * SEMANTIC_WEIGHT,
        highlights,
        lexical,
      },
    ];
  });

  scored.sort((a, b) =>
    b.score === a.score ? b.message.at.getTime() - a.message.at.getTime() : b.score - a.score,
  );
  return {
    hits: options.limit === undefined ? scored : scored.slice(0, options.limit),
    total: scored.length,
    semantic: vectors !== undefined,
    terms,
  };
}
