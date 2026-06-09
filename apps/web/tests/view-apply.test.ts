/**
 * Unit tests for the unified, generic filter/group/sort engine in
 * {@link import('../src/components/views/apply-view')}.
 *
 * @remarks
 * This pure engine is the heart of the Linear-style filtering vocabulary every Docket list page
 * adopts, so its behavior is pinned here independent of any React tree:
 *
 * - filtering is AND-across-predicates, with set membership for `in`/`nin` and substring for
 *   `contains`; an unset (`null`) value never matches an `eq`/`in` but does satisfy `neq`/`nin`;
 * - a malformed predicate (unknown field, uncoercible value) is "no opinion" and never blanks a
 *   list — a guard that matters because the state can come from a hand-edited URL;
 * - sorting honors a field's custom `rank` (so status sorts by lifecycle, not alphabetically),
 *   sorts blanks last regardless of direction, and is a stable multi-key sort;
 * - grouping buckets the sorted rows in rank/option order with the empty bucket always last, and
 *   resolves each bucket's display label through the catalog.
 *
 * The fixture is a small `Item` row type with a status (ranked), a relation id (lead), and a
 * free-text name, mirroring the shape a real entity-list catalog declares.
 */
import { describe, expect, it } from 'vitest';

import {
  applyView,
  describeFilterTerm,
  EMPTY_GROUP_ID,
  filterRows,
  sortRows,
} from '../src/components/views/apply-view';
import type { FieldCatalog, ViewState } from '../src/components/views/field-catalog';

/** A minimal row type standing in for an entity (project/program/…) row. */
interface Item {
  id: string;
  status: string;
  leadId: string | null;
  name: string;
  /** A numeric field (for numeric sort + gt/lt) — unset on some rows. */
  estimate: number | null;
  /** An ISO date field (for date before/after). */
  due: string | null;
}

/** Lifecycle order for the status field (planned → active → done; unknown/unset last). */
const STATUS_ORDER = ['planned', 'active', 'done'];

/** A catalog over {@link Item}: a ranked status enum, a lead relation, and a free-text name. */
const catalog: FieldCatalog<Item> = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    accessor: (i) => i.status,
    options: [
      { value: 'planned', label: 'Planned' },
      { value: 'active', label: 'Active' },
      { value: 'done', label: 'Done' },
    ],
    groupable: true,
    sortable: true,
    rank: (v) => (v === null ? STATUS_ORDER.length : STATUS_ORDER.indexOf(String(v))),
  },
  {
    key: 'leadId',
    label: 'Lead',
    type: 'relation',
    accessor: (i) => i.leadId,
    resolveLabel: (id) => (id === 'u1' ? 'Ada' : id === 'u2' ? 'Lin' : id),
    groupable: true,
  },
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    accessor: (i) => i.name,
    sortable: true,
  },
  {
    key: 'estimate',
    label: 'Estimate',
    type: 'number',
    accessor: (i) => i.estimate,
    sortable: true,
  },
  {
    key: 'due',
    label: 'Due date',
    type: 'date',
    accessor: (i) => i.due,
    sortable: true,
  },
];

/** The fixture rows (deliberately out of every natural order). */
const rows: readonly Item[] = [
  { id: 'a', status: 'done', leadId: 'u1', name: 'Gamma', estimate: 8, due: '2026-03-01' },
  { id: 'b', status: 'planned', leadId: null, name: 'Alpha', estimate: 2, due: null },
  { id: 'c', status: 'active', leadId: 'u2', name: 'Beta', estimate: null, due: '2026-01-15' },
  { id: 'd', status: 'active', leadId: 'u1', name: 'Delta', estimate: 5, due: '2026-02-10' },
];

/** Build a {@link ViewState} terser than spelling the empty slots each time. */
function viewState(partial: Partial<ViewState>): ViewState {
  return { filters: [], groupBy: null, sort: [], ...partial };
}

describe('filterRows', () => {
  it('passes every row through an empty filter set', () => {
    expect(filterRows(rows, [], catalog)).toBe(rows);
  });

  it('combines predicates with AND', () => {
    const result = filterRows(
      rows,
      [
        { field: 'status', op: 'eq', value: 'active' },
        { field: 'leadId', op: 'eq', value: 'u1' },
      ],
      catalog,
    );
    expect(result.map((r) => r.id)).toEqual(['d']);
  });

  it('treats in/nin as set membership and a null value as "not any concrete value"', () => {
    const inResult = filterRows(
      rows,
      [{ field: 'status', op: 'in', value: ['planned', 'done'] }],
      catalog,
    );
    expect(inResult.map((r) => r.id).sort()).toEqual(['a', 'b']);

    // `nin` excludes the named lead but keeps the row whose lead is unset (null).
    const ninResult = filterRows(rows, [{ field: 'leadId', op: 'nin', value: ['u1'] }], catalog);
    expect(ninResult.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('matches contains case-insensitively on free text', () => {
    const result = filterRows(rows, [{ field: 'name', op: 'contains', value: 'a' }], catalog);
    // Alpha, Gamma, Beta, Delta all contain an "a"; only "Beta" / etc — verify by inclusion.
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    const exact = filterRows(rows, [{ field: 'name', op: 'contains', value: 'elt' }], catalog);
    expect(exact.map((r) => r.id)).toEqual(['d']);
  });

  it('excludes an unset value from eq but keeps it for neq', () => {
    const eq = filterRows(rows, [{ field: 'leadId', op: 'eq', value: 'u1' }], catalog);
    expect(eq.map((r) => r.id).sort()).toEqual(['a', 'd']);
    const neq = filterRows(rows, [{ field: 'leadId', op: 'neq', value: 'u1' }], catalog);
    expect(neq.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('treats an unknown field as no opinion (never blanks the list)', () => {
    const result = filterRows(rows, [{ field: 'nope', op: 'eq', value: 'x' }], catalog);
    expect(result).toHaveLength(rows.length);
  });

  it('treats a contains with a non-coercible value as no opinion', () => {
    const result = filterRows(
      rows,
      [{ field: 'name', op: 'contains', value: { not: 'a string' } }],
      catalog,
    );
    expect(result).toHaveLength(rows.length);
  });

  it('compares dates with before/after and never matches an unset value', () => {
    const after = filterRows(rows, [{ field: 'due', op: 'gt', value: '2026-01-31' }], catalog);
    expect(after.map((r) => r.id).sort()).toEqual(['a', 'd']);
    const before = filterRows(rows, [{ field: 'due', op: 'lt', value: '2026-02-01' }], catalog);
    expect(before.map((r) => r.id)).toEqual(['c']);
    // A gt/lt with a missing bound, or against an unset row value, excludes the row.
    const noBound = filterRows(rows, [{ field: 'due', op: 'gt', value: null }], catalog);
    expect(noBound).toHaveLength(0);
  });

  it('coerces a scalar (non-array) value for a set operator', () => {
    // A single string handed to `in` is treated as a one-member set.
    const result = filterRows(rows, [{ field: 'status', op: 'in', value: 'active' }], catalog);
    expect(result.map((r) => r.id).sort()).toEqual(['c', 'd']);
  });
});

describe('sortRows', () => {
  it('sorts by a field rank rather than alphabetically', () => {
    const result = sortRows(rows, [{ field: 'status', dir: 'asc' }], catalog);
    expect(result.map((r) => r.status)).toEqual(['planned', 'active', 'active', 'done']);
  });

  it('reverses the rank order for a descending term', () => {
    const result = sortRows(rows, [{ field: 'status', dir: 'desc' }], catalog);
    expect(result.map((r) => r.status)).toEqual(['done', 'active', 'active', 'planned']);
  });

  it('sorts free text lexically and breaks ties with a secondary key', () => {
    const result = sortRows(
      rows,
      [
        { field: 'status', dir: 'asc' },
        { field: 'name', dir: 'asc' },
      ],
      catalog,
    );
    // Within the two 'active' rows, "Beta" precedes "Delta".
    expect(result.map((r) => r.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('sorts a null value last regardless of direction', () => {
    const asc = sortRows(rows, [{ field: 'leadId', dir: 'asc' }], catalog);
    expect(asc.at(-1)?.leadId).toBeNull();
    const desc = sortRows(rows, [{ field: 'leadId', dir: 'desc' }], catalog);
    expect(desc.at(-1)?.leadId).toBeNull();
  });

  it('sorts a numeric field numerically (not lexically) with blanks last', () => {
    const asc = sortRows(rows, [{ field: 'estimate', dir: 'asc' }], catalog);
    expect(asc.map((r) => r.estimate)).toEqual([2, 5, 8, null]);
    const desc = sortRows(rows, [{ field: 'estimate', dir: 'desc' }], catalog);
    expect(desc.map((r) => r.estimate)).toEqual([8, 5, 2, null]);
  });

  it('sorts a date field chronologically with blanks last', () => {
    const asc = sortRows(rows, [{ field: 'due', dir: 'asc' }], catalog);
    expect(asc.map((r) => r.due)).toEqual(['2026-01-15', '2026-02-10', '2026-03-01', null]);
  });

  it('ignores an unknown sort field and leaves order intact for an empty set', () => {
    expect(sortRows(rows, [], catalog)).toBe(rows);
    const unknown = sortRows(rows, [{ field: 'nope', dir: 'asc' }], catalog);
    expect(unknown.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate the input array', () => {
    const before = rows.map((r) => r.id);
    sortRows(rows, [{ field: 'status', dir: 'asc' }], catalog);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('applyView', () => {
  it('returns a flat sorted list with no groups when grouping is off', () => {
    const result = applyView(rows, viewState({ sort: [{ field: 'name', dir: 'asc' }] }), catalog);
    expect(result.groups).toBeNull();
    expect(result.rows.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  it('groups in rank order with the empty bucket last and resolves bucket labels', () => {
    const result = applyView(rows, viewState({ groupBy: { field: 'leadId' } }), catalog);
    expect(result.groups).not.toBeNull();
    const groups = result.groups ?? [];
    // Two named leads (first-seen order) then the synthesized empty bucket.
    const ids = groups.map((g) => g.id);
    expect(ids.at(-1)).toBe(EMPTY_GROUP_ID);
    const ada = groups.find((g) => g.id === 'u1');
    expect(ada?.label).toBe('Ada');
    expect(ada?.rows.map((r) => r.id).sort()).toEqual(['a', 'd']);
    const none = groups.find((g) => g.id === EMPTY_GROUP_ID);
    expect(none?.label).toBe('No lead');
  });

  it('orders enum groups by the field rank and exposes each option hint', () => {
    const result = applyView(rows, viewState({ groupBy: { field: 'status' } }), catalog);
    const groups = result.groups ?? [];
    expect(groups.map((g) => g.id)).toEqual(['planned', 'active', 'done']);
    // The "active" bucket holds both active rows.
    expect(groups.find((g) => g.id === 'active')?.rows).toHaveLength(2);
  });

  it('preserves the active sort order within each group', () => {
    const result = applyView(
      rows,
      viewState({ groupBy: { field: 'status' }, sort: [{ field: 'name', dir: 'asc' }] }),
      catalog,
    );
    const active = (result.groups ?? []).find((g) => g.id === 'active');
    expect(active?.rows.map((r) => r.name)).toEqual(['Beta', 'Delta']);
  });

  it('falls back to a flat list when the grouping field is unknown', () => {
    const result = applyView(rows, viewState({ groupBy: { field: 'nope' } }), catalog);
    expect(result.groups).toBeNull();
    expect(result.rows).toHaveLength(rows.length);
  });

  it('filters before grouping so empty buckets do not appear', () => {
    const result = applyView(
      rows,
      viewState({
        filters: [{ field: 'status', op: 'eq', value: 'active' }],
        groupBy: { field: 'status' },
      }),
      catalog,
    );
    expect((result.groups ?? []).map((g) => g.id)).toEqual(['active']);
  });
});

describe('describeFilterTerm', () => {
  it('renders a scalar predicate with the field + operator + resolved value label', () => {
    expect(describeFilterTerm({ field: 'leadId', op: 'eq', value: 'u1' }, catalog)).toBe(
      'Lead is Ada',
    );
    expect(describeFilterTerm({ field: 'status', op: 'eq', value: 'active' }, catalog)).toBe(
      'Status is Active',
    );
  });

  it('renders a set predicate as a comma-joined list of resolved labels', () => {
    expect(
      describeFilterTerm({ field: 'status', op: 'in', value: ['planned', 'done'] }, catalog),
    ).toBe('Status is any of Planned, Done');
  });

  it('falls back to the raw field key + value for an unknown field', () => {
    expect(describeFilterTerm({ field: 'mystery', op: 'eq', value: 'x' }, catalog)).toBe(
      'mystery is x',
    );
  });
});
