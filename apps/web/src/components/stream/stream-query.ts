/**
 * `stream` — translate the toolbar's {@link ViewState} into the stream read endpoint's params.
 *
 * @remarks
 * Unlike the entity lists (which filter in memory via `applyView`), the stream is a firehose
 * filtered SERVER-side. This pure adapter turns the same `ViewState` the shared `FilterToolbar`
 * edits into the API's query: the attribute predicates are encoded as a base64url `JSON
 * ViewFilter[]` (the exact stored shape the server's `view-filter-sql` translator decodes), and
 * the `occurredAt` sort becomes `order`. The serialized params also key the TanStack query so
 * each filter variant caches apart.
 */
import type { ViewState } from '@/components/views/field-catalog';

/** The query params sent to `GET /v1/hub/stream` and `GET /v1/orgs/:orgId/stream`. */
export interface StreamQueryParams {
  /** base64url(JSON ViewFilter[]) — attribute predicates applied in SQL. */
  readonly filter?: string;
  /** Sort direction on `occurredAt`. */
  readonly order: 'asc' | 'desc';
}

/** Encode a UTF-8 string as base64url (browser-safe; matches the server's `base64url` decode). */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the stream query params from the active view state.
 *
 * @param state - The toolbar's view state (filters + sort).
 * @returns the `{ filter?, order }` params for the stream read endpoint.
 */
export function streamQueryFromViewState(state: ViewState): StreamQueryParams {
  const order = state.sort.find((s) => s.field === 'occurredAt')?.dir ?? 'desc';
  if (state.filters.length === 0) return { order };
  // ViewFilterTerm is byte-compatible with the stored `ViewFilter` the server decodes.
  const predicates = state.filters.map((t) => ({ field: t.field, op: t.op, value: t.value }));
  return { filter: toBase64Url(JSON.stringify(predicates)), order };
}

/** A stable string of the params (minus cursor) for the TanStack query key. */
export function streamQueryKeyPart(params: StreamQueryParams): string {
  return `${params.order}:${params.filter ?? ''}`;
}
