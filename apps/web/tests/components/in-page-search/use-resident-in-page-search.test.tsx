import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  type CompleteResidentCollection,
  useResidentInPageSearch,
} from '@/components/in-page-search/use-resident-in-page-search';

interface Item {
  readonly id: string;
  readonly text: string;
}

const ITEMS: readonly Item[] = [
  { id: 'one', text: 'Alpha Project plan' },
  { id: 'two', text: 'Beta project alpha notes' },
  { id: 'three', text: 'Gamma review' },
];

function complete(items: readonly Item[]): CompleteResidentCollection<Item> {
  return { completeness: 'complete', items };
}

describe('useResidentInPageSearch', () => {
  it('preserves the source identity and order while the query is empty', () => {
    const { result } = renderHook(() =>
      useResidentInPageSearch({ source: complete(ITEMS), searchableText: (item) => item.text }),
    );

    expect(result.current.items).toBe(ITEMS);
  });

  it('matches every normalized term in any order without changing source order', () => {
    const { result } = renderHook(() =>
      useResidentInPageSearch({ source: complete(ITEMS), searchableText: (item) => item.text }),
    );

    act(() => {
      result.current.setDraft('  PROJECT   alpha ');
    });

    expect(result.current.settledQuery).toBe('  PROJECT   alpha ');
    expect(result.current.items.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('recomputes against an updated complete source', () => {
    const extractor = (item: Item): string => item.text;
    const { result, rerender } = renderHook(
      ({ items }) =>
        useResidentInPageSearch({ source: complete(items), searchableText: extractor }),
      { initialProps: { items: ITEMS } },
    );
    act(() => {
      result.current.setDraft('delta');
    });
    expect(result.current.items).toEqual([]);

    const updated = [...ITEMS, { id: 'four', text: 'Delta launch' }];
    rerender({ items: updated });

    expect(result.current.items.map((item) => item.id)).toEqual(['four']);
  });

  it('indexes searchable text once per source change instead of once per query', () => {
    const searchableText = vi.fn((item: Item) => item.text);
    const { result } = renderHook(() =>
      useResidentInPageSearch({ source: complete(ITEMS), searchableText }),
    );
    expect(searchableText).toHaveBeenCalledTimes(ITEMS.length);

    act(() => {
      result.current.setDraft('alpha');
    });
    act(() => {
      result.current.setDraft('gamma');
    });

    expect(searchableText).toHaveBeenCalledTimes(ITEMS.length);
  });
});
