import '@testing-library/jest-dom/vitest';

import type { VocabularySkin } from '@docket/work/vocabulary';
import { act, renderHook } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type ListKeyboardEvent, useListKeyboard } from '../../src/hooks/useListKeyboard';
import { useMediaQuery } from '../../src/hooks/useMediaQuery';
import { useRedirectIfAuthenticated } from '../../src/hooks/useRedirectIfAuthenticated';
import { useVocabulary, VocabularyProvider } from '../../src/hooks/useVocabulary';

/** Minimal KeyboardEvent stand-in for the hook's handler (only the fields it reads). */
function keyEvent(key: string, overrides: Partial<ListKeyboardEvent> = {}): ListKeyboardEvent {
  return { key, preventDefault: vi.fn(), ...overrides };
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

  it('ignores every handled key when the event target is a text-entry element', () => {
    const onActiveChange = vi.fn();
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onActiveChange }));
    const input = document.createElement('input');
    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown', { target: input }));
    });
    expect(result.current.activeIndex).toBe(-1);
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('ignores a handled key when the target is contenteditable', () => {
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, initialIndex: 1 }));
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    act(() => {
      result.current.onKeyDown(keyEvent('Escape', { target: div }));
    });
    expect(result.current.activeIndex).toBe(1);
  });

  it('fires onPropertyKey for an unmodified letter on the active row and consumes it when handled', () => {
    const onPropertyKey = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() =>
      useListKeyboard({ rowCount: 3, initialIndex: 1, onPropertyKey }),
    );
    const event = keyEvent('l');
    act(() => {
      result.current.onKeyDown(event);
    });
    expect(onPropertyKey).toHaveBeenCalledWith('l', 1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('lowercases the dispatched key', () => {
    const onPropertyKey = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() =>
      useListKeyboard({ rowCount: 2, initialIndex: 0, onPropertyKey }),
    );
    act(() => {
      result.current.onKeyDown(keyEvent('L'));
    });
    expect(onPropertyKey).toHaveBeenCalledWith('l', 0);
  });

  it('leaves an unhandled property key untouched (no preventDefault)', () => {
    const onPropertyKey = vi.fn().mockReturnValue(false);
    const { result } = renderHook(() =>
      useListKeyboard({ rowCount: 2, initialIndex: 0, onPropertyKey }),
    );
    const event = keyEvent('q');
    act(() => {
      result.current.onKeyDown(event);
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('never dispatches onPropertyKey for a modified keystroke', () => {
    const onPropertyKey = vi.fn();
    const { result } = renderHook(() =>
      useListKeyboard({ rowCount: 3, initialIndex: 0, onPropertyKey }),
    );
    act(() => {
      result.current.onKeyDown(keyEvent('l', { metaKey: true }));
    });
    act(() => {
      result.current.onKeyDown(keyEvent('l', { ctrlKey: true }));
    });
    act(() => {
      result.current.onKeyDown(keyEvent('l', { altKey: true }));
    });
    expect(onPropertyKey).not.toHaveBeenCalled();
  });

  it('does not dispatch onPropertyKey when no row is active', () => {
    const onPropertyKey = vi.fn();
    const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onPropertyKey }));
    act(() => {
      result.current.onKeyDown(keyEvent('l'));
    });
    expect(onPropertyKey).not.toHaveBeenCalled();
  });

  it('does not dispatch onPropertyKey for multi-character keys (arrows, Enter, etc.)', () => {
    const onPropertyKey = vi.fn();
    const { result } = renderHook(() =>
      useListKeyboard({ rowCount: 3, initialIndex: 0, onPropertyKey }),
    );
    act(() => {
      result.current.onKeyDown(keyEvent('ArrowDown'));
    });
    expect(onPropertyKey).not.toHaveBeenCalled();
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

describe('useMediaQuery', () => {
  it('reads the current match state from window.matchMedia', () => {
    // The suite-wide setup stubs matchMedia to always answer `matches: false`.
    const { result } = renderHook(() => useMediaQuery('(min-width: 64rem)'));
    expect(result.current).toBe(false);
  });

  it('reacts to a change event on the media query list', () => {
    let changeListener: (() => void) | undefined;
    const mql = {
      matches: false,
      addEventListener: (_type: string, listener: () => void) => {
        changeListener = listener;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    );
    try {
      const { result } = renderHook(() => useMediaQuery('(min-width: 64rem)'));
      expect(result.current).toBe(false);
      mql.matches = true;
      act(() => {
        changeListener?.();
      });
      expect(result.current).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to false, without throwing, when matchMedia is unavailable', () => {
    // Simulates an SSR-like environment; jsdom does implement matchMedia (via the suite-wide
    // stub), so this removes it for the duration of the test and restores it afterward.
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    // @ts-expect-error - deliberately simulating an environment without matchMedia
    delete window.matchMedia;
    try {
      const { result } = renderHook(() => useMediaQuery('(min-width: 64rem)'));
      expect(result.current).toBe(false);
    } finally {
      if (originalMatchMedia !== undefined) {
        Object.defineProperty(window, 'matchMedia', originalMatchMedia);
      }
    }
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

describe('useRedirectIfAuthenticated', () => {
  it('does not redirect while the session read is still pending', () => {
    const onRedirect = vi.fn();
    renderHook(() => {
      useRedirectIfAuthenticated(null, true, onRedirect, '/home');
    });
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it('redirects once a session is present on the first resolve', () => {
    const onRedirect = vi.fn();
    renderHook(() => {
      useRedirectIfAuthenticated({ user: { id: '1' } }, false, onRedirect, '/home');
    });
    expect(onRedirect).toHaveBeenCalledWith('/home');
    expect(onRedirect).toHaveBeenCalledTimes(1);
  });

  it('never redirects when no session is ever present', () => {
    const onRedirect = vi.fn();
    const { rerender } = renderHook(
      ({ session }) => {
        useRedirectIfAuthenticated(session, false, onRedirect, '/home');
      },
      { initialProps: { session: null as { user: { id: string } } | null } },
    );
    rerender({ session: null });
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it('evaluates a function destination lazily, at redirect time', () => {
    const onRedirect = vi.fn();
    let live = '/first';
    renderHook(() => {
      useRedirectIfAuthenticated({ user: { id: '1' } }, false, onRedirect, () => live);
    });
    expect(onRedirect).toHaveBeenCalledWith('/first');
    live = '/second';
  });

  it('regression: does not race a session that appears AFTER the initial resolve', () => {
    // This is the exact production incident: a page's own sign-in/sign-up ceremony mints a
    // session partway through the component's life, reactively flipping `session` from null to
    // present. A naive effect watching `session` for the component's whole lifetime would fire a
    // second, wrong redirect right as the ceremony's own navigation resolves. This hook must only
    // ever act on the FIRST resolve.
    const onRedirect = vi.fn();
    const { rerender } = renderHook(
      ({ session, isPending }) => {
        useRedirectIfAuthenticated(session, isPending, onRedirect, '/home');
      },
      {
        initialProps: {
          session: null as { user: { id: string } } | null,
          isPending: false,
        },
      },
    );
    expect(onRedirect).not.toHaveBeenCalled();

    // The page's own ceremony mints a session later in the component's life.
    rerender({ session: { user: { id: '1' } }, isPending: false });
    expect(onRedirect).not.toHaveBeenCalled();
  });
});
