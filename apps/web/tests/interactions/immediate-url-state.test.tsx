import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImmediateUrlState } from '../../src/lib/interactions/immediate-url-state';

describe('useImmediateUrlState', () => {
  it('shows a local selection in the same turn before the canonical query state commits', () => {
    const { result } = renderHook(({ canonical }) => useImmediateUrlState(canonical), {
      initialProps: { canonical: 'cards' },
    });

    act(() => {
      result.current[1]('list');
    });

    expect(result.current[0]).toBe('list');
  });

  it('adopts canonical state after the matching query state commits', () => {
    const { result, rerender } = renderHook(({ canonical }) => useImmediateUrlState(canonical), {
      initialProps: { canonical: 'cards' },
    });

    act(() => {
      result.current[1]('list');
    });
    rerender({ canonical: 'list' });

    expect(result.current[0]).toBe('list');

    rerender({ canonical: 'cards' });

    expect(result.current[0]).toBe('cards');
  });

  it('does not let an older canonical navigation overwrite a newer local selection', () => {
    const { result, rerender } = renderHook(({ canonical }) => useImmediateUrlState(canonical), {
      initialProps: { canonical: 'cards' },
    });

    act(() => {
      result.current[1]('list');
      result.current[1]('table');
    });
    rerender({ canonical: 'list' });

    expect(result.current[0]).toBe('table');

    rerender({ canonical: 'table' });

    expect(result.current[0]).toBe('table');
  });
});
