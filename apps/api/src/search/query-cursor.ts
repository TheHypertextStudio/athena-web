/**
 * `@docket/api` — ranked-search ordering and its opaque pagination cursor.
 */
import { createHash } from 'node:crypto';

import { ValidationError } from '../error';
import type { ScoredRow } from './query-types';

const SEARCH_CURSOR_PREFIX = 'sq1:';

interface SearchCursorEnvelope {
  readonly version: 1;
  readonly mode: 'ranked' | 'browse';
  readonly fingerprint: string;
  readonly position: Record<string, unknown>;
}

/** The opaque pagination cursor's decoded shape: the boundary row's rank and identity. */
export interface CursorShape {
  readonly score: number;
  readonly sortTime: number;
  readonly id: string;
  readonly rankedAt: number;
}

/** A decoded browse cursor carrying the internal `(updatedAt, id)` keyset position. */
export interface BrowseCursorShape {
  readonly position: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function invalidCursor(message: string): never {
  throw new ValidationError([{ path: ['cursor'], message }]);
}

function encodeEnvelope(envelope: SearchCursorEnvelope): string {
  return `${SEARCH_CURSOR_PREFIX}${Buffer.from(stableJson(envelope), 'utf8').toString('base64url')}`;
}

function parseEnvelope(value: string): Partial<SearchCursorEnvelope> {
  if (!value.startsWith(SEARCH_CURSOR_PREFIX)) throw new TypeError('Wrong cursor version');
  const parsed = JSON.parse(
    Buffer.from(value.slice(SEARCH_CURSOR_PREFIX.length), 'base64url').toString('utf8'),
  ) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Cursor is not an object');
  }
  return parsed;
}

function isEnvelopeForMode(
  envelope: Partial<SearchCursorEnvelope>,
  mode: SearchCursorEnvelope['mode'],
): envelope is SearchCursorEnvelope {
  const position: unknown = envelope.position;
  return (
    envelope.version === 1 &&
    envelope.mode === mode &&
    typeof envelope.fingerprint === 'string' &&
    position !== null &&
    typeof position === 'object' &&
    !Array.isArray(position)
  );
}

function decodeEnvelope(
  value: string | undefined,
  mode: SearchCursorEnvelope['mode'],
  expectedFingerprint: string,
): SearchCursorEnvelope | null {
  if (value === undefined) return null;
  try {
    const envelope = parseEnvelope(value);
    if (!isEnvelopeForMode(envelope, mode)) throw new TypeError('Cursor shape is invalid');
    if (envelope.fingerprint !== expectedFingerprint) {
      return invalidCursor('This page cursor belongs to another search query');
    }
    return envelope;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return invalidCursor('This page cursor is invalid');
  }
}

/**
 * Fingerprint the effective search scope, ordering mode, and normalized filters.
 *
 * @param descriptor - The canonical request descriptor assembled after access filtering.
 * @returns A stable SHA-256 identity embedded in every search cursor.
 */
export function fingerprintSearchQuery(descriptor: object): string {
  return `sha256:${createHash('sha256').update(stableJson(descriptor)).digest('hex')}`;
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

/** Encode a ranked row as the query-bound opaque cursor naming a page boundary. */
export function encodeCursor(row: ScoredRow, rankedAt: number, fingerprint: string): string {
  return encodeEnvelope({
    version: 1,
    mode: 'ranked',
    fingerprint,
    position: {
      score: row.score,
      sortTime: row.sortTime,
      id: row.row.id,
      rankedAt,
    } satisfies CursorShape,
  });
}

/**
 * Decode a ranked cursor and prove that it belongs to the effective query.
 *
 * @throws {ValidationError} When the cursor is malformed or belongs to another query.
 */
export function decodeCursor(
  value: string | undefined,
  expectedFingerprint: string,
): CursorShape | null {
  const envelope = decodeEnvelope(value, 'ranked', expectedFingerprint);
  if (!envelope) return null;
  const position = envelope.position as Partial<CursorShape>;
  if (
    typeof position.score === 'number' &&
    Number.isFinite(position.score) &&
    typeof position.sortTime === 'number' &&
    Number.isFinite(position.sortTime) &&
    typeof position.id === 'string' &&
    position.id.length > 0 &&
    typeof position.rankedAt === 'number' &&
    Number.isFinite(position.rankedAt)
  ) {
    return position as CursorShape;
  }
  return invalidCursor('This page cursor is invalid');
}

/** Encode an internal browse keyset position as a query-bound public cursor. */
export function encodeBrowseCursor(position: string, fingerprint: string): string {
  return encodeEnvelope({
    version: 1,
    mode: 'browse',
    fingerprint,
    position: { value: position },
  });
}

/**
 * Decode a browse cursor and prove that it belongs to the effective query.
 *
 * @throws {ValidationError} When the cursor is malformed or belongs to another query.
 */
export function decodeBrowseCursor(
  value: string | undefined,
  expectedFingerprint: string,
): BrowseCursorShape | null {
  const envelope = decodeEnvelope(value, 'browse', expectedFingerprint);
  if (!envelope) return null;
  const valuePosition = envelope.position['value'];
  if (typeof valuePosition !== 'string' || valuePosition.length === 0) {
    return invalidCursor('This page cursor is invalid');
  }
  return { position: valuePosition };
}
