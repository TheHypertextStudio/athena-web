import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: harness.replace, push: harness.push }),
}));
vi.mock('@/lib/app-location', () => ({
  useAppPathname: () => '/orgs/org-1/library',
  useAppSearchParams: () => new URLSearchParams(harness.search),
}));

import { useViewState } from '@/components/views/use-view-state';

const DEFAULTS = { groupBy: { field: 'usedIn' } } as const;

beforeEach(() => {
  harness.search = '';
  harness.replace.mockReset();
  harness.push.mockReset();
});

describe('useViewState coordinated URL writes', () => {
  it('preserves a pending view change when search updates before the router catches up', () => {
    const { result } = renderHook(() => useViewState(DEFAULTS));

    act(() => {
      result.current.setGroupBy({ field: 'provider' });
      result.current.setSearchParam('q', 'launch');
    });

    expect(harness.replace).toHaveBeenLastCalledWith(
      '/orgs/org-1/library?group=provider&q=launch',
      { scroll: false },
    );
  });

  it('preserves a pending search when a view change follows it', () => {
    const { result } = renderHook(() => useViewState(DEFAULTS));

    act(() => {
      result.current.setSearchParam('q', 'launch');
      result.current.setGroupBy({ field: 'provider' });
    });

    expect(harness.replace).toHaveBeenLastCalledWith(
      '/orgs/org-1/library?q=launch&group=provider',
      { scroll: false },
    );
  });

  it('pushes detail state through the same pending URL transaction', () => {
    const { result } = renderHook(() => useViewState(DEFAULTS));

    act(() => {
      result.current.setGroupBy({ field: 'provider' });
      result.current.setSearchParam('q', 'launch');
      result.current.pushSearchParam('resourceId', 'resource-1');
    });

    expect(harness.push).toHaveBeenLastCalledWith(
      '/orgs/org-1/library?group=provider&q=launch&resourceId=resource-1',
      { scroll: false },
    );
  });

  it('pushes several related parameters in one history transaction', () => {
    harness.search = 'q=calendar&group=provider';
    const { result } = renderHook(() => useViewState(DEFAULTS));

    act(() => {
      result.current.pushSearchParams({ q: null, resourceId: 'resource-1' });
    });

    expect(harness.replace).not.toHaveBeenCalled();
    expect(harness.push).toHaveBeenCalledWith(
      '/orgs/org-1/library?group=provider&resourceId=resource-1',
      { scroll: false },
    );
  });
});
