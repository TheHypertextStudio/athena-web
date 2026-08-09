import '@testing-library/jest-dom/vitest';

import { LabelId, OrganizationId } from '@docket/types';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePrefix, useLabelPaletteMode } from '@/components/command-palette/sub-modes';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BUG = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');

describe('parsePrefix', () => {
  it('splits a leading # into the labels mode and the remaining term', () => {
    expect(parsePrefix('#bug')).toEqual({ mode: '#', term: 'bug' });
  });

  it('treats a bare # as the labels mode with an empty term', () => {
    expect(parsePrefix('#')).toEqual({ mode: '#', term: '' });
  });

  it('has no mode for a query with no recognized prefix', () => {
    expect(parsePrefix('bug')).toEqual({ mode: null, term: 'bug' });
  });

  it('has no mode for an empty query', () => {
    expect(parsePrefix('')).toEqual({ mode: null, term: '' });
  });
});

describe('useLabelPaletteMode', () => {
  it('shows no items and is not loading with no bound organization', () => {
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useLabelPaletteMode('', { activeOrgId: null, close: vi.fn() }),
      { wrapper },
    );
    expect(result.current).toEqual({ items: [], loading: false, error: null });
  });

  it('lists the org labels matching the term, navigating to the filtered task list on select', async () => {
    vi.doMock('@/lib/api', () => ({
      api: {
        v1: {
          orgs: {
            ':orgId': {
              labels: {
                $get: vi.fn().mockResolvedValue({
                  ok: true,
                  status: 200,
                  json: () =>
                    Promise.resolve({
                      items: [
                        {
                          id: BUG,
                          organizationId: ORG,
                          name: 'Bug',
                          color: '#ef4444',
                          teamId: null,
                          createdAt: '2026-08-01T00:00:00.000Z',
                        },
                      ],
                    }),
                }),
              },
            },
          },
        },
      },
    }));
    // `sub-modes.ts` (and its `labels/queries.ts` -> `@/lib/api` chain) was already evaluated and
    // cached via this file's static top-level import, before `vi.doMock` above ran. Re-importing
    // the same specifier without clearing the module registry would return that stale, unmocked
    // instance -- `resetModules` forces the re-import below to pick up the mock.
    vi.resetModules();
    const { useLabelPaletteMode: freshHook } =
      await import('@/components/command-palette/sub-modes');
    const close = vi.fn();
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => freshHook('bu', { activeOrgId: ORG, close }), { wrapper });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]).toMatchObject({ label: 'Bug' });

    result.current.items[0]!.run();
    expect(close).toHaveBeenCalledOnce();
    vi.doUnmock('@/lib/api');
  });

  it('filters out labels that do not match the term', async () => {
    vi.doMock('@/lib/api', () => ({
      api: {
        v1: {
          orgs: {
            ':orgId': {
              labels: {
                $get: vi.fn().mockResolvedValue({
                  ok: true,
                  status: 200,
                  json: () =>
                    Promise.resolve({
                      items: [
                        {
                          id: BUG,
                          organizationId: ORG,
                          name: 'Bug',
                          color: '#ef4444',
                          teamId: null,
                          createdAt: '2026-08-01T00:00:00.000Z',
                        },
                      ],
                    }),
                }),
              },
            },
          },
        },
      },
    }));
    vi.resetModules();
    const { useLabelPaletteMode: freshHook } =
      await import('@/components/command-palette/sub-modes');
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => freshHook('zzz', { activeOrgId: ORG, close: vi.fn() }), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // Asserting `error` is null (not just `items` being empty) distinguishes "the mocked label
    // list loaded and none matched" from "the request failed" -- both leave `items` at `[]`.
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(0);
    vi.doUnmock('@/lib/api');
  });
});
