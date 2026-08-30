import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ search: '', replace: vi.fn() }));

vi.mock('@/lib/app-location', () => ({
  useAppPathname: () => '/orgs/org-1/initiatives/initiative-1',
  useAppSearchParams: () => new URLSearchParams(harness.search),
}));
vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ replace: harness.replace }),
}));

import { useDetailTab } from '@/components/views/use-detail-tab';

beforeEach(() => {
  harness.search = '';
  harness.replace.mockReset();
});

describe('useDetailTab', () => {
  it('uses Overview for absent or invalid values', () => {
    harness.search = 'tab=not-a-section';
    const { result } = renderHook(() => useDetailTab(['overview', 'work'] as const));
    expect(result.current.tab).toBe('overview');
  });

  it('preserves unrelated parameters and omits the Overview tab from the URL', () => {
    harness.search = 'q=bus&tab=work';
    const { result } = renderHook(() => useDetailTab(['overview', 'work'] as const));

    act(() => {
      result.current.setTab('overview');
    });

    expect(harness.replace).toHaveBeenCalledWith('/orgs/org-1/initiatives/initiative-1?q=bus', {
      scroll: false,
    });
  });

  it('writes a non-default tab without a scroll jump', () => {
    const { result } = renderHook(() => useDetailTab(['overview', 'work'] as const));

    act(() => {
      result.current.setTab('work');
    });

    expect(result.current.tab).toBe('work');
    expect(harness.replace).toHaveBeenCalledWith('/orgs/org-1/initiatives/initiative-1?tab=work', {
      scroll: false,
    });
  });
});
