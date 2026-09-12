/**
 * `@docket/api` — row-level filter predicates shared by ranked search and browse.
 */
import type { SearchDocumentRow, SearchQueryParams } from './query-types';

/** The row's effective timestamp: its own occurrence time, else the source's update time, else
 * the search document's own `updatedAt`. */
export function rowSortTime(row: SearchDocumentRow): number {
  return row.occurredAt?.getTime() ?? row.sourceUpdatedAt?.getTime() ?? row.updatedAt.getTime();
}

/** The `facet` JSON keys a row's owner can be named under — a field varies by kind (`ownerId` vs
 * `leadId`), so every alias is checked at once wherever "owner" is filtered or counted. */
export const OWNER_FACET_KEYS = ['ownerId', 'leadId', 'ownerActorId', 'accountableOwnerId'];

/** The `facet` JSON keys a row's assignee can be named under. */
export const ASSIGNEE_FACET_KEYS = ['assigneeId', 'delegateId'];

/** The `facet` JSON keys a row's label(s) can be named under. */
export const LABEL_FACET_KEYS = ['labelId', 'labelIds'];

/** The `facet` JSON keys a row's status can be named under. */
export const STATUS_FACET_KEYS = ['status', 'state'];

/** The `facet` JSON key a row's health can be named under. */
export const HEALTH_FACET_KEYS = ['health'];

/** Read a row's `facet` JSON blob as a plain record, or `{}` when it isn't shaped like one. */
export function facetRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Whether a facet value (a string or an array of strings) contains any of `expected`. */
export function valueMatchesAny(value: unknown, expected: readonly string[]): boolean {
  if (typeof value === 'string') return expected.includes(value);
  if (Array.isArray(value))
    return value.some((item) => typeof item === 'string' && expected.includes(item));
  return false;
}

/** Whether any of `keys` on `facet` matches one of `expected` — a field can be named several
 * ways across kinds (`ownerId` vs `leadId`), so a filter checks every alias at once. */
export function facetMatchesAny(
  facet: Record<string, unknown>,
  keys: readonly string[],
  expected: readonly string[],
): boolean {
  return keys.some((key) => valueMatchesAny(facet[key], expected));
}

/** Whether `row` passes every active facet, date-range, and kind/family filter in `params`. */
export function filterRow(
  row: SearchDocumentRow,
  params: SearchQueryParams,
  fromTime: number | null,
  toTime: number | null,
): boolean {
  if (params.families?.length && !params.families.includes(row.family)) return false;
  if (params.kinds?.length && !params.kinds.includes(row.kind)) return false;
  if (params.sources?.length && (!row.sourceSystem || !params.sources.includes(row.sourceSystem))) {
    return false;
  }
  const facet = facetRecord(row.facet);
  if (params.ownerIds?.length && !facetMatchesAny(facet, OWNER_FACET_KEYS, params.ownerIds)) {
    return false;
  }
  if (
    params.assigneeIds?.length &&
    !facetMatchesAny(facet, ASSIGNEE_FACET_KEYS, params.assigneeIds)
  ) {
    return false;
  }
  if (params.labelIds?.length && !facetMatchesAny(facet, LABEL_FACET_KEYS, params.labelIds)) {
    return false;
  }
  if (params.statuses?.length && !facetMatchesAny(facet, STATUS_FACET_KEYS, params.statuses)) {
    return false;
  }
  if (params.healths?.length && !facetMatchesAny(facet, HEALTH_FACET_KEYS, params.healths)) {
    return false;
  }
  const rowTime = rowSortTime(row);
  if (fromTime !== null && rowTime < fromTime) return false;
  if (toTime !== null && rowTime > toTime) return false;
  return true;
}
