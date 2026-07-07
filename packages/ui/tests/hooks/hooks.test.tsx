import '@testing-library/jest-dom/vitest';

import type { VocabularySkin } from '@docket/types';
import { act, renderHook } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type ListKeyboardEvent, useListKeyboard } from '../../src/hooks/useListKeyboard';
import { useVocabulary, VocabularyProvider } from '../../src/hooks/useVocabulary';

/** Minimal KeyboardEvent stand-in for the hook's handler (only `key` + `preventDefault`). */
function keyEvent(key: string): ListKeyboardEvent {
  return { key, preventDefault: vi.fn() };
}

describe('useListKeyboard', () => {
  it('starts at the initial index (-1 by default)', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 5 }));
    expect(result.current.activeIndex).toBe(-1);
  });

  it('honors a custom initial index', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 5, initialIndex: 2 }));
    expect(result.current.activeIndex).toBe(2);
  });

  it('ArrowDown from -1 selects row 0 and fires onActiveChange', () => {
    const onActiveChange = vi.fn();
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onActiveChange }));
    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown'));
    });
    expect(result.current.activeIndex).toBe(0);
    expect(onActiveChange).toHaveBeenCalledWith(0);
  });

  it('ArrowDown advances and clamps at the last row', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 2, initialIndex: 0 }));
    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown'));
    });
    expect(result.current.activeIndex).toBe(1);
    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown'));
    });
    expect(result.current.activeIndex).toBe(1);
  });

  it('ArrowUp from -1 selects the last row, then decrements and clamps at -1', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3 }));
    const press = (key: string): void => {
      act(() => {
        result.current.onKeyDown(keyEvent(key));
      });
    };
    press('ArrowUp');
    expect(result.current.activeIndex).toBe(2);
    press('ArrowUp');
    press('ArrowUp');
    expect(result.current.activeIndex).toBe(0);
    press('ArrowUp');
    expect(result.current.activeIndex).toBe(-1);
  });

  it('Home and End jump to the first and last rows', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 4 }));
    act(() => {
      result.current.onKeyDown(keyEvent('End'));
    });
    expect(result.current.activeIndex).toBe(3);
    act(() => {
      result.current.onKeyDown(keyEvent('Home'));
    });
    expect(result.current.activeIndex).toBe(0);
  });

  it('Enter activates the active row but is a no-op when no row is active', () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onActivate }));
    // No active row yet -> Enter does nothing.
    act(() => {
      result.current.onKeyDown(keyEvent('Enter'));
    });
    expect(onActivate).not.toHaveBeenCalled();
    // Select a row (separate act so the handler closure picks up the new index).
    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown'));
    });
    act(() => {
      result.current.onKeyDown(keyEvent('Enter'));
    });
    expect(onActivate).toHaveBeenCalledWith(0);
  });

  it('Enter without an onActivate handler does not throw', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 2, initialIndex: 0 }));
    expect(() => {
      act(() => {
        result.current.onKeyDown(keyEvent('Enter'));
      });
    }).not.toThrow();
  });

  it('Escape clears the active row', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, initialIndex: 1 }));
    act(() => {
      result.current.onKeyDown(keyEvent('Escape'));
    });
    expect(result.current.activeIndex).toBe(-1);
  });

  it('ignores unrelated keys', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, initialIndex: 1 }));
    act(() => {
      result.current.onKeyDown(keyEvent('Tab'));
    });
    expect(result.current.activeIndex).toBe(1);
  });

  it('setActiveIndex clamps to range and to -1, firing onActiveChange only for valid rows', () => {
    const onActiveChange = vi.fn();
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onActiveChange }));
    act(() => {
      result.current.setActiveIndex(10);
    });
    expect(result.current.activeIndex).toBe(2);
    expect(onActiveChange).toHaveBeenLastCalledWith(2);
    act(() => {
      result.current.setActiveIndex(-5);
    });
    expect(result.current.activeIndex).toBe(-1);
    // onActiveChange must not fire for the cleared (-1) case.
    expect(onActiveChange).toHaveBeenCalledTimes(1);
  });

  it('clamps the active index when rowCount shrinks below it', () => {
    const { result, rerender } = renderHook(({ rowCount }) => useListKeyboard({ rowCount }), {
      initialProps: { rowCount: 5 },
    });
    act(() => {
      result.current.setActiveIndex(4);
    });
    expect(result.current.activeIndex).toBe(4);
    rerender({ rowCount: 2 });
    expect(result.current.activeIndex).toBe(1);
  });

  it('leaves the active index unchanged when rowCount grows', () => {
    const { result, rerender } = renderHook(({ rowCount }) => useListKeyboard({ rowCount }), {
      initialProps: { rowCount: 3 },
    });
    act(() => {
      result.current.setActiveIndex(1);
    });
    rerender({ rowCount: 6 });
    expect(result.current.activeIndex).toBe(1);
  });
});

describe('useVocabulary', () => {
  const wrap = (skin: VocabularySkin | null) =>
    function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
      return <VocabularyProvider skin={skin}>{children}</VocabularyProvider>;
    };

  it('falls back to the startup preset with no provider', () => {
    const { result } = renderHook(() => useVocabulary('program'));
    expect(result.current).toBe('Program');
  });

  it('falls back to the startup preset when the provider skin is null (Hub)', () => {
    const { result } = renderHook(() => useVocabulary('cycle', { plural: true }), {
      wrapper: wrap(null),
    });
    expect(result.current).toBe('Cycles');
  });

  it('resolves singular and plural under the agency preset', () => {
    const { result: singular } = renderHook(() => useVocabulary('cycle'), {
      wrapper: wrap({ preset: 'agency' }),
    });
    expect(singular.current).toBe('Sprint');
    const { result: plural } = renderHook(() => useVocabulary('team', { plural: true }), {
      wrapper: wrap({ preset: 'agency' }),
    });
    expect(plural.current).toBe('Pods');
  });

  it('resolves under the nonprofit preset', () => {
    const { result } = renderHook(() => useVocabulary('program', { plural: true }), {
      wrapper: wrap({ preset: 'nonprofit' }),
    });
    expect(result.current).toBe('Programs');
  });

  it('honors a per-key override above the preset', () => {
    const skin: VocabularySkin = {
      preset: 'agency',
      overrides: { program: { singular: 'Account', plural: 'Accounts' } },
    };
    const { result: singular } = renderHook(() => useVocabulary('program'), {
      wrapper: wrap(skin),
    });
    expect(singular.current).toBe('Account');
    const { result: plural } = renderHook(() => useVocabulary('program', { plural: true }), {
      wrapper: wrap(skin),
    });
    expect(plural.current).toBe('Accounts');
  });
});
