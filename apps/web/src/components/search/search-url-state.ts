import type { SearchDocumentFamily, SearchDocumentKind, SourceSystemKind } from '@docket/types';

/** Search-document families supported by the shareable search-page URL. */
export const SEARCH_FAMILY_VALUES = ['work', 'people', 'content', 'activity'] as const;

/** Search-document kinds supported by the shareable search-page URL. */
export const SEARCH_KIND_VALUES = [
  'organization',
  'team',
  'member',
  'agent',
  'agent_session',
  'task',
  'project',
  'program',
  'initiative',
  'milestone',
  'cycle',
  'label',
  'saved_view',
  'comment',
  'update',
  'attachment',
  'calendar_event',
  'activity',
] as const satisfies readonly SearchDocumentKind[];

/** Source systems supported by the shareable search-page URL. */
export const SEARCH_SOURCE_VALUES = [
  'docket',
  'linear',
  'github',
  'google_calendar',
  'gmail',
] as const satisfies readonly SourceSystemKind[];

const FAMILY_SET = new Set<string>(SEARCH_FAMILY_VALUES);
const KIND_SET = new Set<string>(SEARCH_KIND_VALUES);
const SOURCE_SET = new Set<string>(SEARCH_SOURCE_VALUES);

interface SearchParamReader {
  get(name: string): string | null;
  toString(): string;
}

/** URL-backed state for the full search page. */
export interface SearchPageFilters {
  query: string;
  families: readonly SearchDocumentFamily[];
  kinds: readonly SearchDocumentKind[];
  sources: readonly SourceSystemKind[];
  orgIds: readonly string[];
  ownerIds: readonly string[];
  assigneeIds: readonly string[];
  labelIds: readonly string[];
  statuses: readonly string[];
  healths: readonly string[];
  fromDate: string;
  toDate: string;
}

/** Query object accepted by the typed Hono search client. */
export interface SearchHttpQueryParams {
  q: string;
  limit: string;
  cursor?: string;
  families?: string;
  kinds?: string;
  sources?: string;
  orgIds?: string;
  ownerIds?: string;
  assigneeIds?: string;
  labelIds?: string;
  statuses?: string;
  healths?: string;
  from?: string;
  to?: string;
}

/** Parse shareable `/search` URL params into strongly typed filter state. */
export function parseSearchPageFilters(params: SearchParamReader): SearchPageFilters {
  const kinds = enumList<SearchDocumentKind>(params.get('kinds'), KIND_SET);
  const legacyKind = enumList<SearchDocumentKind>(params.get('kind'), KIND_SET);
  return {
    query: params.get('q')?.trim() ?? '',
    families: enumList<SearchDocumentFamily>(params.get('families'), FAMILY_SET),
    kinds: kinds.length > 0 ? kinds : legacyKind,
    sources: enumList<SourceSystemKind>(params.get('sources'), SOURCE_SET),
    orgIds: csvList(params.get('orgIds')),
    ownerIds: csvList(params.get('ownerIds')),
    assigneeIds: csvList(params.get('assigneeIds')),
    labelIds: csvList(params.get('labelIds')),
    statuses: csvList(params.get('statuses')),
    healths: csvList(params.get('healths')),
    fromDate: dateOnly(params.get('from')),
    toDate: dateOnly(params.get('to')),
  };
}

/** Return a URL for the current search page with the semantic filters encoded. */
export function searchPageHref(
  pathname: string,
  currentParams: SearchParamReader,
  filters: SearchPageFilters,
): string {
  const params = new URLSearchParams(currentParams.toString());
  setParam(params, 'q', filters.query);
  setCsvParam(params, 'families', filters.families);
  setCsvParam(params, 'kinds', filters.kinds);
  setCsvParam(params, 'sources', filters.sources);
  setCsvParam(params, 'orgIds', filters.orgIds);
  setCsvParam(params, 'ownerIds', filters.ownerIds);
  setCsvParam(params, 'assigneeIds', filters.assigneeIds);
  setCsvParam(params, 'labelIds', filters.labelIds);
  setCsvParam(params, 'statuses', filters.statuses);
  setCsvParam(params, 'healths', filters.healths);
  setParam(params, 'from', filters.fromDate);
  setParam(params, 'to', filters.toDate);
  params.delete('cursor');
  params.delete('href');
  params.delete('id');
  params.delete('kind');
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Translate page filter state into the API's comma-separated HTTP query shape. */
export function searchPageFiltersToHttpQuery(
  filters: SearchPageFilters,
  options: { limit: number; cursor?: string | null },
): SearchHttpQueryParams {
  return {
    q: filters.query,
    limit: String(options.limit),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(filters.families.length > 0 ? { families: filters.families.join(',') } : {}),
    ...(filters.kinds.length > 0 ? { kinds: filters.kinds.join(',') } : {}),
    ...(filters.sources.length > 0 ? { sources: filters.sources.join(',') } : {}),
    ...(filters.orgIds.length > 0 ? { orgIds: filters.orgIds.join(',') } : {}),
    ...(filters.ownerIds.length > 0 ? { ownerIds: filters.ownerIds.join(',') } : {}),
    ...(filters.assigneeIds.length > 0 ? { assigneeIds: filters.assigneeIds.join(',') } : {}),
    ...(filters.labelIds.length > 0 ? { labelIds: filters.labelIds.join(',') } : {}),
    ...(filters.statuses.length > 0 ? { statuses: filters.statuses.join(',') } : {}),
    ...(filters.healths.length > 0 ? { healths: filters.healths.join(',') } : {}),
    ...(filters.fromDate ? { from: localDateToIso(filters.fromDate, 'start') } : {}),
    ...(filters.toDate ? { to: localDateToIso(filters.toDate, 'end') } : {}),
  };
}

function enumList<T extends string>(value: string | null, allowed: ReadonlySet<string>): T[] {
  return csvList(value).filter((item): item is T => allowed.has(item));
}

function csvList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function setParam(params: URLSearchParams, key: string, value: string): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

function setCsvParam(params: URLSearchParams, key: string, values: readonly string[]): void {
  if (values.length > 0) params.set(key, values.join(','));
  else params.delete(key);
}

function dateOnly(value: string | null): string {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
}

function localDateToIso(date: string, edge: 'start' | 'end'): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const value =
    edge === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  return value.toISOString();
}
