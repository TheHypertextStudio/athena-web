/**
 * `@docket/api` — relevance scoring and reader-facing snippet extraction for one search row.
 */
import { markdownToPlainText } from '../content/markdown-links';
import {
  ASSIGNEE_FACET_KEYS,
  facetMatchesAny,
  facetRecord,
  OWNER_FACET_KEYS,
  rowSortTime,
} from './query-filters';
import type { ScoredRow, SearchDocumentRow, SnippetMatch } from './query-types';

/** Split a lowercased query into its individual words, for the term-level fallback match. */
export function queryTerms(queryLower: string): string[] {
  return queryLower
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** Whether `value` contains any of `terms`. */
export function containsAnyTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

/** A score bonus that decays linearly from 20 to 0 over the 20 days after `sortTime`. */
export function recencyBoost(sortTime: number, rankedAt: number): number {
  const daysAgo = Math.max(0, (rankedAt - sortTime) / 86_400_000);
  return Math.max(0, 20 - Math.min(20, daysAgo));
}

function relationshipBoost(
  row: SearchDocumentRow,
  context: { ownerUserId: string | null; callerActorId: string | null; activityRecipient: boolean },
): number {
  let boost = context.ownerUserId !== null && row.userId === context.ownerUserId ? 8 : 0;
  if (context.activityRecipient) boost += 10;
  if (!context.callerActorId) return boost;
  const facet = facetRecord(row.facet);
  if (
    facetMatchesAny(facet, [...OWNER_FACET_KEYS, ...ASSIGNEE_FACET_KEYS], [context.callerActorId])
  ) {
    boost += 12;
  }
  return boost;
}

/** A row with no actual match still gets a snippet from whatever summary/body it has, so a
 * result never renders with nothing under its title — used by both scoring and browse. */
export function fallbackSnippetMatch(row: SearchDocumentRow): SnippetMatch | null {
  const fallback = row.summary ?? row.body;
  return fallback === null || fallback === '' ? null : { value: fallback, term: '' };
}

/**
 * Pick which raw field a snippet should be drawn from, and the exact substring that matched.
 *
 * @remarks
 * Cheap on purpose — only string `.includes()` checks, mirroring `scoreRow`'s own matching logic
 * exactly so the two never disagree about which field matched. This runs for every scored
 * candidate (up to hundreds, pre-pagination); the expensive part, flattening Markdown, is
 * {@link snippetText} and only runs for the page of rows actually returned — see
 * `toSearchResult`.
 */
export function pickSnippetMatch(
  row: SearchDocumentRow,
  queryLower: string,
  terms: readonly string[],
): SnippetMatch | null {
  for (const value of [row.title, row.summary, row.body]) {
    if (value?.toLowerCase().includes(queryLower)) return { value, term: queryLower };
  }
  for (const term of terms) {
    for (const value of [row.title, row.summary, row.body]) {
      if (value?.toLowerCase().includes(term)) return { value, term };
    }
  }
  return fallbackSnippetMatch(row);
}

/** Raw-text context kept on each side of a match, wide enough that flattening it still reads as a sentence. */
const SNIPPET_CONTEXT_CHARS = 140;

/** Escape a string for literal use inside a `RegExp` pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A window of `value` centered on the match at `matchIndex`, wide enough for readable context. */
function windowAroundMatch(value: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(value.length, matchIndex + matchLength + SNIPPET_CONTEXT_CHARS);
  return value.slice(start, end);
}

/**
 * Render a matched field as reader-facing text: the title/summary verbatim, everything else
 * stripped of Markdown and windowed around the term that matched.
 *
 * @remarks
 * `title` and `summary` are already plain text by the time they reach here (`work.ts`'s projectors
 * flatten `summary` at write time), so returning them as-is both skips needless work and avoids
 * re-running the flattener on already-flat text — a second pass can strip a character a user
 * escaped on purpose (`\#` flattens to a literal `#` once; flattening that again reads it as a
 * real heading marker and strips it).
 *
 * `body` still carries the full raw Markdown, and a query can match deep inside it — windowing
 * around the actual match position (rather than always flattening from the start of the document)
 * is what keeps the returned snippet containing the term `matchedFields` says it matched on. When
 * the term only existed inside Markdown syntax the flattener removes (a link href, a fenced code
 * block), this falls back to the raw window itself so the snippet still shows what matched, rather
 * than silently showing unrelated text.
 */
export function snippetText(row: SearchDocumentRow, match: SnippetMatch): string {
  const { value, term } = match;
  if (value === row.title || value === row.summary) return value;
  if (term === '') {
    const plain = markdownToPlainText(value);
    return plain === '' ? value : plain;
  }
  // A case-insensitive regex search runs against `value` itself, unlike
  // `value.toLowerCase().indexOf(term)` — some characters (e.g. Turkish "İ") lowercase to more
  // UTF-16 units than they started with, which offsets an index found in a lowercased copy from
  // its true position in the original string.
  const matchIndex = value.search(new RegExp(escapeRegExp(term), 'i'));
  const windowed = matchIndex === -1 ? value : windowAroundMatch(value, matchIndex, term.length);
  const plain = markdownToPlainText(windowed);
  if (plain.toLowerCase().includes(term)) return plain === '' ? value : plain;
  const raw = windowed.replace(/\s+/g, ' ').trim();
  return raw === '' ? value : raw;
}

/** Score a candidate row against a query, or return `null` when nothing about it actually
 * matched (title/summary/body substring or term overlap). */
export function scoreRow(
  row: SearchDocumentRow,
  query: string,
  context: {
    activeOrgId: string | null;
    ownerUserId: string | null;
    callerActorId: string | null;
    activityRecipient: boolean;
    rankedAt: number;
  },
): ScoredRow | null {
  const queryLower = query.toLowerCase();
  const terms = queryTerms(queryLower);
  const title = row.title.toLowerCase();
  const summary = row.summary?.toLowerCase() ?? '';
  const body = row.body?.toLowerCase() ?? '';
  const matchedFields: ScoredRow['matchedFields'] = [];
  let score = row.baseRank + row.textRank * 100;

  if (title === queryLower) {
    score += 90;
    matchedFields.push('title');
  } else if (title.startsWith(queryLower)) {
    score += 60;
    matchedFields.push('title');
  } else if (title.includes(queryLower)) {
    score += 40;
    matchedFields.push('title');
  }
  if (summary.includes(queryLower)) {
    score += 20;
    matchedFields.push('summary');
  }
  if (body.includes(queryLower)) {
    score += 10;
    matchedFields.push('body');
  }
  if (matchedFields.length === 0 && terms.length > 0) {
    if (containsAnyTerm(title, terms)) {
      score += 30;
      matchedFields.push('title');
    }
    if (containsAnyTerm(summary, terms)) {
      score += 15;
      matchedFields.push('summary');
    }
    if (containsAnyTerm(body, terms)) {
      score += 8;
      matchedFields.push('body');
    }
  }
  if (row.organizationId && row.organizationId === context.activeOrgId) score += 5;
  score += relationshipBoost(row, context);
  if (matchedFields.length === 0) return null;

  const sortTime = rowSortTime(row);
  score += recencyBoost(sortTime, context.rankedAt);
  return {
    row,
    score,
    sortTime,
    matchedFields: [...new Set(matchedFields)],
    snippetMatch: pickSnippetMatch(row, queryLower, terms),
  };
}
