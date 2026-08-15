import type { ConversationMessage } from './conversation-contracts';
import { topicTerms } from './conversation-terms';

/** A half-open character range in a message's raw text. */
export interface TextSpan {
  /** Inclusive offset. */
  readonly start: number;
  /** Exclusive offset. */
  readonly end: number;
}

/** One matched conversation message. */
export interface ConversationSearchHit {
  /** Original message. */
  readonly message: ConversationMessage;
  /** Relative relevance score. */
  readonly score: number;
  /** Literal-match spans in display text. */
  readonly highlights: readonly TextSpan[];
  /** Whether a literal query word matched. */
  readonly lexical: boolean;
}

/** All optional search constraints compose conjunctively. */
export interface ConversationSearchQuery {
  /** Free-text query. */
  readonly text?: string;
  /** Inclusive time lower bound. */
  readonly from?: Date;
  /** Inclusive time upper bound. */
  readonly to?: Date;
}

/** Optional result cap and vector ranking inputs. */
export interface ConversationSearchOptions {
  /** Result cap. */
  readonly limit?: number;
  /** Query and message vectors for semantic ranking. */
  readonly vectors?: ConversationVectors;
}

/** Vector inputs for semantic ranking. */
export interface ConversationVectors {
  /** Query embedding. */
  readonly query: readonly number[];
  /** Stable message id to its embedding. */
  readonly byMessageId: ReadonlyMap<string, readonly number[]>;
}

/** One truthful search outcome. */
export interface ConversationSearchResult {
  /** Matching rows in best-first order. */
  readonly hits: readonly ConversationSearchHit[];
  /** Number of results before an optional cap. */
  readonly total: number;
  /** Whether supplied vector ranking was actually used. */
  readonly semantic: boolean;
  /** Normalized query terms. */
  readonly terms: readonly string[];
}

/** Port used by a host to obtain semantic vectors. */
export interface ConversationEmbedder {
  /** Embed inputs in order and return equally ordered, same-dimension vectors. */
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const SEMANTIC_WEIGHT = 2;

function literalWords(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Find every whole-word literal match in display text. */
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

/** Compute cosine similarity, treating zero-norm vectors as no similarity. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** Test whether a timestamp falls inside optional inclusive bounds. */
export function withinRange(at: Date, from?: Date, to?: Date): boolean {
  const time = at.getTime();
  return (!from || time >= from.getTime()) && (!to || time <= to.getTime());
}

/**
 * Search a conversation with exhaustive literal matching and optional semantic ranking.
 *
 * A lexical hit is never discarded simply because a more relevant score exists; an optional
 * `limit` is the only explicit way a caller can request fewer rows.
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
      .sort((left, right) => right.at.getTime() - left.at.getTime())
      .map((message) => ({ message, score: 0, highlights: [], lexical: false }));
    return {
      hits: options.limit === undefined ? hits : hits.slice(0, options.limit),
      total: hits.length,
      semantic: false,
      terms,
    };
  }

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
      const frequencyInCorpus = documentFrequency.get(term) ?? 0;
      const idf = Math.log(
        1 + (documents.length - frequencyInCorpus + 0.5) / (frequencyInCorpus + 0.5),
      );
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
  scored.sort((left, right) =>
    right.score === left.score
      ? right.message.at.getTime() - left.message.at.getTime()
      : right.score - left.score,
  );
  return {
    hits: options.limit === undefined ? scored : scored.slice(0, options.limit),
    total: scored.length,
    semantic: vectors !== undefined,
    terms,
  };
}
