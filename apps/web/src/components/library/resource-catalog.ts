/**
 * The Library's field catalog: what a workspace resource can be filtered, grouped, and sorted by.
 *
 * @remarks
 * Declared against `SearchResult` rather than a bespoke row type, because the Library is a browse
 * over the same read model the command palette searches. One shape, one endpoint, one visibility
 * filter.
 *
 * The interesting field is `usedIn`. It is multi-valued — a document genuinely serves two
 * initiatives — which is why {@link FieldDescriptor.values} exists at all. Grouping by it fans a
 * row into every container it serves, so the group sizes sum to more than the row count on purpose.
 */
import { RESOURCE_PROVIDER_LABEL, type ResourceProvider, type SearchResult } from '@docket/types';

import type { FieldCatalog, FieldOption } from '@/components/views/field-catalog';

/** The kinds the Library shows: material, not work-tracking. */
export const LIBRARY_KINDS = ['external_resource', 'attachment'] as const;

/**
 * What each Library group is called.
 *
 * @remarks
 * Overrides the shared kind registry, whose values are singular row labels ("Resource") and read
 * wrong as a group heading over eleven of them. The words also carry the distinction the page is
 * built on: a linked resource's body lives elsewhere, an attached one was added by hand.
 */
const LIBRARY_KIND_GROUP_LABEL: Record<(typeof LIBRARY_KINDS)[number], string> = {
  external_resource: 'Linked',
  attachment: 'Attached',
};

/** Read a string off a result's facet bag, which is typed as unknown per key. */
function facetString(row: SearchResult, key: string): string | null {
  const value = row.facets[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The display name for a resource provider.
 *
 * @remarks
 * Delegates to the registry exported from `@docket/types`, which is derived from `RESOURCE_PROVIDERS`
 * and is therefore total — adding a provider is a compile error there rather than a raw enum value
 * rendered in a menu. A local copy had already drifted from it on two of nine entries.
 */
export function providerLabel(value: string): string {
  return value in RESOURCE_PROVIDER_LABEL
    ? RESOURCE_PROVIDER_LABEL[value as ResourceProvider]
    : value;
}

/** The provider a row came from, or `null` for first-party rows that have none. */
export function providerOf(row: SearchResult): string | null {
  return facetString(row, 'provider');
}

/** Whether the row's title is the resource's real name or a URL standing in for one. */
export function titleResolved(row: SearchResult): boolean {
  return row.facets['titleResolved'] !== false;
}

/**
 * Build the Library catalog.
 *
 * @remarks
 * `usedIn` options are derived from the loaded page rather than from a separate query: the
 * containers worth filtering by are exactly the ones present in the rows on screen, and deriving
 * them costs nothing. That does mean the chooser lists only what this page references, which is
 * the honest scope for a client-side filter over a paginated list.
 *
 * @param rows - The loaded rows, used to derive the relation options.
 * @returns The catalog the shared toolbar and apply engine both read.
 */
export function buildResourceCatalog(rows: readonly SearchResult[]): FieldCatalog<SearchResult> {
  const containers = new Map<string, string>();
  const providers = new Set<string>();
  for (const row of rows) {
    for (const container of row.usedIn) containers.set(container.id, container.title);
    const provider = providerOf(row);
    if (provider) providers.add(provider);
  }

  const containerOptions: readonly FieldOption[] = [...containers.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const providerOptions: readonly FieldOption[] = [...providers]
    .map((value) => ({ value, label: providerLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    {
      key: 'name',
      label: 'Name',
      type: 'text',
      accessor: (row) => row.title,
      sortable: true,
    },
    {
      key: 'type',
      label: 'Type',
      type: 'enum',
      accessor: (row) => row.kind,
      options: LIBRARY_KINDS.map((kind) => ({
        value: kind,
        label: LIBRARY_KIND_GROUP_LABEL[kind],
      })),
      groupable: true,
    },
    {
      key: 'usedIn',
      label: 'Used in',
      type: 'relation',
      // The primary container, which is what a sort on this field orders by.
      accessor: (row) => row.usedIn[0]?.id ?? null,
      values: (row) => row.usedIn.map((container) => container.id),
      options: containerOptions,
      groupable: true,
    },
    {
      key: 'provider',
      label: 'Source',
      type: 'enum',
      accessor: (row) => providerOf(row),
      options: providerOptions,
      groupable: true,
    },
    {
      key: 'updated',
      label: 'Updated',
      type: 'date',
      accessor: (row) => row.updatedAt,
      sortable: true,
    },
  ];
}
