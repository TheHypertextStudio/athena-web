/**
 * Unit tests for the {@link ViewState} ↔ URL codec in
 * {@link import('../src/components/views/view-state-url')}.
 *
 * @remarks
 * The unified filter toolbar persists its state to the URL so a configured list is shareable and
 * survives a reload. These tests pin the codec contract the `useViewState` hook depends on:
 *
 * - a well-formed state round-trips through `serialize` → `parse` unchanged (the shareable-link
 *   guarantee);
 * - the encoding is compact and legible (`field:op:value`, comma-joined set values, `field:dir`
 *   sort terms);
 * - serializing replaces only the codec's own keys and preserves any unrelated params (a tab id),
 *   so persisting view state never clobbers other URL state;
 * - parsing is tolerant: a malformed or hand-edited token is dropped, never thrown on, and a
 *   value containing the `:`/`,` separators survives via component-encoding.
 */
import { describe, expect, it } from 'vitest';

import type { ViewState } from '../src/components/views/field-catalog';
import {
  isEmptyViewState,
  parseViewState,
  serializeViewState,
} from '../src/components/views/view-state-url';

/** Parse a `ViewState` from a raw query string. */
function parse(query: string): ViewState {
  return parseViewState(new URLSearchParams(query));
}

/** Serialize a `ViewState` (optionally onto a base query) to a query string. */
function serialize(state: ViewState, base?: string): string {
  return serializeViewState(state, base ? new URLSearchParams(base) : undefined).toString();
}

describe('serializeViewState', () => {
  it('encodes filters, grouping, and sort in a compact, legible form', () => {
    const state: ViewState = {
      filters: [
        { field: 'status', op: 'eq', value: 'active' },
        { field: 'leadId', op: 'in', value: ['u1', 'u2'] },
      ],
      groupBy: { field: 'health' },
      sort: [{ field: 'targetDate', dir: 'desc' }],
    };
    const query = serialize(state);
    const params = new URLSearchParams(query);
    expect(params.getAll('filter')).toEqual(['status:eq:active', 'leadId:in:u1,u2']);
    expect(params.get('group')).toBe('health');
    expect(params.getAll('sort')).toEqual(['targetDate:desc']);
  });

  it('emits no view keys for the empty state', () => {
    expect(serialize({ filters: [], groupBy: null, sort: [] })).toBe('');
  });

  it('preserves unrelated params and replaces only the codec keys', () => {
    const state: ViewState = {
      filters: [{ field: 'status', op: 'eq', value: 'active' }],
      groupBy: null,
      sort: [],
    };
    // The base carries an unrelated `tab` plus a stale `filter` that must be replaced.
    const params = new URLSearchParams(serialize(state, 'tab=42&filter=status:eq:done'));
    expect(params.get('tab')).toBe('42');
    expect(params.getAll('filter')).toEqual(['status:eq:active']);
  });

  it('drops a set predicate with no values and a scalar predicate with a null value', () => {
    const state: ViewState = {
      filters: [
        { field: 'leadId', op: 'in', value: [] },
        { field: 'status', op: 'eq', value: null },
      ],
      groupBy: null,
      sort: [],
    };
    expect(serialize(state)).toBe('');
  });

  it('coerces numeric and boolean filter values to strings', () => {
    const state: ViewState = {
      filters: [
        { field: 'estimate', op: 'gt', value: 5 },
        { field: 'archived', op: 'eq', value: true },
        { field: 'tier', op: 'in', value: [1, 2] },
      ],
      groupBy: null,
      sort: [],
    };
    const params = new URLSearchParams(serialize(state));
    expect(params.getAll('filter')).toEqual(['estimate:gt:5', 'archived:eq:true', 'tier:in:1,2']);
  });

  it('drops a predicate whose scalar value cannot be coerced (an object)', () => {
    const state: ViewState = {
      filters: [{ field: 'status', op: 'eq', value: { weird: true } }],
      groupBy: null,
      sort: [],
    };
    expect(serialize(state)).toBe('');
  });
});

describe('parseViewState', () => {
  it('parses a full query back into a ViewState', () => {
    const state = parse('filter=status%3Aeq%3Aactive&group=health&sort=targetDate%3Adesc');
    expect(state.filters).toEqual([{ field: 'status', op: 'eq', value: 'active' }]);
    expect(state.groupBy).toEqual({ field: 'health' });
    expect(state.sort).toEqual([{ field: 'targetDate', dir: 'desc' }]);
  });

  it('yields the empty state for an empty query', () => {
    expect(parse('')).toEqual({ filters: [], groupBy: null, sort: [] });
  });

  it('drops malformed tokens rather than throwing', () => {
    const state = parse(
      'filter=no-colons&filter=field%3Abadop%3Av&sort=field-only&group=&filter=status%3Aeq%3Aok',
    );
    // Only the one well-formed filter survives; the bad op + colon-less + empty group are dropped.
    expect(state.filters).toEqual([{ field: 'status', op: 'eq', value: 'ok' }]);
    expect(state.sort).toEqual([]);
    expect(state.groupBy).toBeNull();
  });

  it('reads a set predicate as a string array, ignoring empty members', () => {
    const state = parse('filter=leadId%3Anin%3Au1%2C%2Cu2');
    expect(state.filters).toEqual([{ field: 'leadId', op: 'nin', value: ['u1', 'u2'] }]);
  });

  it('tolerates a malformed percent-escape in a token rather than throwing', () => {
    // `%zz` is not a valid escape; `safeDecode` returns the raw segment instead of throwing, so
    // the predicate still parses (with the un-decoded value) rather than blanking the list.
    const state = parse('filter=name%3Acontains%3A100%25zz');
    expect(state.filters).toEqual([{ field: 'name', op: 'contains', value: '100%zz' }]);
  });
});

describe('round-trip', () => {
  it('serialize(parse(x)) preserves a well-formed state', () => {
    const original: ViewState = {
      filters: [
        { field: 'status', op: 'neq', value: 'canceled' },
        { field: 'leadId', op: 'in', value: ['u1', 'u2'] },
        { field: 'name', op: 'contains', value: 'launch' },
      ],
      groupBy: { field: 'status' },
      sort: [{ field: 'name', dir: 'asc' }],
    };
    const reparsed = parse(serialize(original));
    expect(reparsed).toEqual(original);
  });

  it('survives a value containing the separator characters', () => {
    const original: ViewState = {
      filters: [{ field: 'name', op: 'contains', value: 'a:b, c' }],
      groupBy: null,
      sort: [],
    };
    const reparsed = parse(serialize(original));
    expect(reparsed.filters).toEqual([{ field: 'name', op: 'contains', value: 'a:b, c' }]);
  });
});

describe('isEmptyViewState', () => {
  it('is true only for the fully-empty state', () => {
    expect(isEmptyViewState({ filters: [], groupBy: null, sort: [] })).toBe(true);
    expect(
      isEmptyViewState({
        filters: [{ field: 'x', op: 'eq', value: '1' }],
        groupBy: null,
        sort: [],
      }),
    ).toBe(false);
    expect(isEmptyViewState({ filters: [], groupBy: { field: 'x' }, sort: [] })).toBe(false);
  });
});
