import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDelayedBoolean } from '@/lib/use-delayed-boolean';

describe('useDelayedBoolean', () => {
  it('withholds visible progress until the quiet reconciliation window elapses', () => {
    vi.useFakeTimers();
    const hook = renderHook(({ pending }) => useDelayedBoolean(pending, 300), {
      initialProps: { pending: true },
    });

    expect(hook.result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(hook.result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.result.current).toBe(true);

    hook.rerender({ pending: false });
    expect(hook.result.current).toBe(false);
    vi.useRealTimers();
  });
});
