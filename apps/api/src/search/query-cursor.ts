/**
 * `@docket/api` — ranked-search ordering and its opaque pagination cursor.
 */
import type { ScoredRow } from './query-types';

/** The opaque pagination cursor's decoded shape: the boundary row's rank and identity. */
export interface CursorShape {
  score: number;
  sortTime: number;
  id: string;
  rankedAt: number;
}

/** Order two scored rows by score, then recency, then id — the sort behind every ranked page. */
export function compareScoredRows(a: ScoredRow, b: ScoredRow): number {
  return b.score - a.score || b.sortTime - a.sortTime || a.row.id.localeCompare(b.row.id);
}

/** Compare a row against a decoded cursor using the same ordering as {@link compareScoredRows}. */
export function compareCursor(row: ScoredRow, cursor: CursorShape): number {
  if (row.score !== cursor.score) return cursor.score - row.score;
  if (row.sortTime !== cursor.sortTime) return cursor.sortTime - row.sortTime;
  return row.row.id.localeCompare(cursor.id);
}

/** Encode a row as the opaque cursor naming it as a page boundary. */
export function encodeCursor(row: ScoredRow, rankedAt: number): string {
  return Buffer.from(
    JSON.stringify({
      score: row.score,
      sortTime: row.sortTime,
      id: row.row.id,
      rankedAt,
    } satisfies CursorShape),
  ).toString('base64url');
}

/** Decode a cursor produced by {@link encodeCursor}; malformed or absent input is `null`. */
export function decodeCursor(value: string | undefined): CursorShape | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorShape;
    if (
      typeof parsed.score === 'number' &&
      typeof parsed.sortTime === 'number' &&
      typeof parsed.id === 'string' &&
      typeof parsed.rankedAt === 'number'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
