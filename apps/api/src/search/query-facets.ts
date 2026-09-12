/**
 * `@docket/api` — facet counting and summarization for a set of search rows.
 */
import type { SearchOut } from '../contracts/search';
import {
  ASSIGNEE_FACET_KEYS,
  facetRecord,
  HEALTH_FACET_KEYS,
  LABEL_FACET_KEYS,
  OWNER_FACET_KEYS,
  STATUS_FACET_KEYS,
} from './query-filters';
import type { ScoredRow, SearchDocumentRow } from './query-types';

interface FacetCounts {
  readonly family: Map<string, number>;
  readonly kind: Map<string, number>;
  readonly source: Map<string, number>;
  readonly owner: Map<string, number>;
  readonly assignee: Map<string, number>;
  readonly label: Map<string, number>;
  readonly status: Map<string, number>;
  readonly health: Map<string, number>;
}

/** A fresh, empty tally for every facet field a search response can summarize. */
export function createFacetCounts(): FacetCounts {
  return {
    family: new Map(),
    kind: new Map(),
    source: new Map(),
    owner: new Map(),
    assignee: new Map(),
    label: new Map(),
    status: new Map(),
    health: new Map(),
  };
}

function addFacetValues(
  counts: Map<string, number>,
  facet: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = facet[key];
    if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') counts.set(item, (counts.get(item) ?? 0) + 1);
      }
    }
  }
}

/** Tally one row's family, kind, source, and facet-field values into `counts`, in place. */
export function addFacetCountRow(counts: FacetCounts, row: SearchDocumentRow): void {
  counts.family.set(row.family, (counts.family.get(row.family) ?? 0) + 1);
  counts.kind.set(row.kind, (counts.kind.get(row.kind) ?? 0) + 1);
  if (row.sourceSystem) {
    counts.source.set(row.sourceSystem, (counts.source.get(row.sourceSystem) ?? 0) + 1);
  }
  const facet = facetRecord(row.facet);
  addFacetValues(counts.owner, facet, OWNER_FACET_KEYS);
  addFacetValues(counts.assignee, facet, ASSIGNEE_FACET_KEYS);
  addFacetValues(counts.label, facet, LABEL_FACET_KEYS);
  addFacetValues(counts.status, facet, STATUS_FACET_KEYS);
  addFacetValues(counts.health, facet, HEALTH_FACET_KEYS);
}

function facetSummary(
  field: string,
  label: string,
  counts: Map<string, number>,
): SearchOut['facets'][number] {
  return {
    field,
    label,
    values: [...counts.entries()].map(([value, count]) => ({ value, label: value, count })),
  };
}

/** Render every non-empty facet field's counts as the response's `facets` array. */
export function facetSummaries(counts: FacetCounts): SearchOut['facets'] {
  return [
    facetSummary('family', 'Family', counts.family),
    facetSummary('kind', 'Kind', counts.kind),
    facetSummary('source', 'Source', counts.source),
    facetSummary('owner', 'Owner', counts.owner),
    facetSummary('assignee', 'Assignee', counts.assignee),
    facetSummary('label', 'Label', counts.label),
    facetSummary('status', 'Status', counts.status),
    facetSummary('health', 'Health', counts.health),
  ].filter((facet) => facet.values.length > 0);
}

/** Compute a browse page's `facets` directly from its own rows (browse has no separate scan to
 * tally against, unlike ranked search's `facetSummaries` over `scanRankedCandidates`'s counts). */
export function buildFacetSummaries(rows: readonly ScoredRow[]): SearchOut['facets'] {
  const counts = createFacetCounts();
  for (const { row } of rows) {
    addFacetCountRow(counts, row);
  }
  return facetSummaries(counts);
}
