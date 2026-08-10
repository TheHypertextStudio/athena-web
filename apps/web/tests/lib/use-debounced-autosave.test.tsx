import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDebouncedAutosave', () => {
  it('collapses rapid edits into one save of the final value after the quiet period', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ draft }) =>
        useDebouncedAutosave({ value: draft, baseline: 'Persisted', save, delayMs: 2_000 }),
      { initialProps: { draft: 'Persisted' } },
    );

    rerender({ draft: 'First partial sentence' });
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    rerender({ draft: 'The final settled sentence.' });
    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(save).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('The final settled sentence.');
  });

  it('flushes the latest dirty value immediately and cancels the trailing timer', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { result, rerender } = renderHook(
      ({ draft }) =>
        useDebouncedAutosave({ value: draft, baseline: 'Persisted', save, delayMs: 2_000 }),
      { initialProps: { draft: 'Persisted' } },
    );

    rerender({ draft: 'First draft' });
    rerender({ draft: 'Final draft' });
    act(() => {
      result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('Final draft');

    act(() => {
      vi.runAllTimers();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not save before a baseline exists, after a revert, or while unchanged', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ baseline, draft }) =>
        useDebouncedAutosave({ value: draft, baseline, save, delayMs: 2_000 }),
      { initialProps: { baseline: undefined as string | undefined, draft: 'Local draft' } },
    );

    act(() => {
      vi.runAllTimers();
    });
    rerender({ baseline: 'Persisted', draft: 'Changed' });
    rerender({ baseline: 'Persisted', draft: 'Persisted' });
    act(() => {
      vi.runAllTimers();
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a pending timer when the hook unmounts', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ draft }) =>
        useDebouncedAutosave({ value: draft, baseline: 'Persisted', save, delayMs: 2_000 }),
      { initialProps: { draft: 'Persisted' } },
    );

    rerender({ draft: 'Dirty' });
    unmount();
    act(() => {
      vi.runAllTimers();
    });
    expect(save).not.toHaveBeenCalled();
  });
});
