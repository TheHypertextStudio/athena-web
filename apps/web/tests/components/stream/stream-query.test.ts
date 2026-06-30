import { describe, expect, it } from 'vitest';

import { EMPTY_VIEW_STATE, type ViewState } from '@/components/views/field-catalog';
import { streamQueryFromViewState, streamQueryKeyPart } from '@/components/stream/stream-query';

function decode(filter: string): unknown {
  return JSON.parse(Buffer.from(filter, 'base64url').toString('utf8'));
}

describe('streamQueryFromViewState', () => {
  it('defaults to order desc with no filter for the empty state', () => {
    expect(streamQueryFromViewState(EMPTY_VIEW_STATE)).toEqual({ order: 'desc' });
  });

  it('encodes filter predicates as base64url JSON ViewFilter[]', () => {
    const state: ViewState = {
      filters: [{ field: 'provider', op: 'in', value: ['linear', 'slack'] }],
      groupBy: null,
      sort: [],
    };
    const params = streamQueryFromViewState(state);
    expect(params.filter).toBeDefined();
    expect(decode(params.filter!)).toEqual([
      { field: 'provider', op: 'in', value: ['linear', 'slack'] },
    ]);
  });

  it('maps the occurredAt sort term to order', () => {
    const state: ViewState = { filters: [], groupBy: null, sort: [{ field: 'occurredAt', dir: 'asc' }] };
    expect(streamQueryFromViewState(state).order).toBe('asc');
  });

  it('round-trips a unicode filter value', () => {
    const state: ViewState = {
      filters: [{ field: 'actor', op: 'contains', value: 'Mañana 🌮' }],
      groupBy: null,
      sort: [],
    };
    const params = streamQueryFromViewState(state);
    expect(decode(params.filter!)).toEqual([
      { field: 'actor', op: 'contains', value: 'Mañana 🌮' },
    ]);
  });

  it('key part distinguishes filter variants', () => {
    expect(streamQueryKeyPart({ order: 'desc' })).not.toBe(
      streamQueryKeyPart({ order: 'desc', filter: 'abc' }),
    );
  });
});
