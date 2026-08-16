/**
 * Optimistic-write behaviour for {@link useProjectMutations}, plus the initiative-toggle
 * regression that first brought this file into existence.
 *
 * @remarks
 * Two separate concerns live here, and they are worth keeping apart when reading:
 *
 * **The optimistic contract.** A project field edit and an initiative link/unlink are both
 * writes a person makes from the properties panel, so both are held to the same two claims every
 * task mutation is held to in `use-task-mutations.test.tsx`:
 *
 * 1. the cache carries the new value **before** the mutation promise settles, and
 * 2. a forced failure restores the previous value **and** surfaces application-owned copy.
 *
 * Claim 2 is checked against a deliberately hostile rejection — a message shaped like a
 * driver/transport leak — because the rule is not merely "show an error", it is that no provider or
 * exception text ever reaches the screen. `unwrap` is the boundary that enforces that, so these
 * writes are exercised through it rather than around it.
 *
 * **The initiative-diff regression.** Selecting an initiative used to appear to "add then
 * immediately unadd" itself: the mutation diffed the toggle against
 * `queryClient.getQueryData(detailKey)` inside `mutationFn`, but by the time `mutationFn` ran,
 * `onMutate` had already optimistically overwritten that same cache entry with the *next* state — so
 * the diff against "current" always computed empty adds/removes, no API call fired, and the later
 * cache invalidation snapped the UI back to the pre-toggle list.
 */
import { OrganizationId, ProjectId } from '@docket/types';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { initiativeProjectsPost, initiativeProjectDelete, projectPatch } = vi.hoisted(() => ({
  initiativeProjectsPost: vi.fn(),
  initiativeProjectDelete: vi.fn(),
  projectPatch: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: {
            ':id': {
              projects: {
                $post: initiativeProjectsPost,
                ':projectId': { $delete: initiativeProjectDelete },
              },
            },
          },
          projects: { ':id': { $patch: projectPatch } },
          updates: { $post: vi.fn() },
        },
      },
    },
  },
}));

import { useProjectMutations } from '../../src/lib/use-project-mutations';
import { queryKeys } from '../../src/lib/query';
import type { ProjectDetailData } from '../../src/lib/fetch-project-detail';

const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const PROJECT_ID = ProjectId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const INITIATIVE_ID = '01BX5ZZKBKACTAV9WEVGEMMVS2';
const OTHER_INITIATIVE_ID = '01BX5ZZKBKACTAV9WEVGEMMVS3';

/**
 * A message shaped like raw transport/driver output.
 *
 * @remarks
 * If any assertion below ever finds this string on the surfaced error, the app is leaking provider
 * text into UI copy — the precise failure the `UserFacingError` boundary exists to prevent.
 */
const LEAKY_REJECTION = 'ECONNREFUSED 10.0.0.4:5432 — pg pool exhausted (driver stack follows)';

/** Return a typed mock Hono response for the mutation unwrap layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A promise plus the handles to settle it, so "before it resolves" is observable. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The detail snapshot the cache holds before any of these writes run.
 *
 * @remarks
 * Cast rather than assembled: these tests exercise cache reads/writes, and only the fields the
 * mutations under test touch carry meaning. A fully-populated `ProjectDetailData` (ten sub-reads
 * deep) would add noise, not coverage.
 *
 * @param initiativeIds - The initiative links the project starts with.
 * @returns A minimal detail snapshot.
 */
function baseDetail(initiativeIds: readonly string[] = []): ProjectDetailData {
  return {
    project: {
      id: PROJECT_ID,
      name: 'Launch checklist',
      health: 'on_track',
      targetDate: null,
      status: 'active',
    },
    initiativeIds,
    labels: [],
    availableLabels: [],
  } as unknown as ProjectDetailData;
}

function makeWrapper(): {
  client: QueryClient;
  wrapper: (props: { children: ReactNode }) => JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

/** Mount the hook against a fresh cache seeded with {@link baseDetail}. */
function mountMutations(initiativeIds: readonly string[] = []) {
  const { client, wrapper } = makeWrapper();
  const detailKey = queryKeys.project(ORG_ID, PROJECT_ID);
  client.setQueryData<ProjectDetailData>(detailKey, baseDetail(initiativeIds));
  const { result } = renderHook(() => useProjectMutations(ORG_ID, PROJECT_ID), { wrapper });
  const read = (): ProjectDetailData | undefined =>
    client.getQueryData<ProjectDetailData>(detailKey);
  return { client, detailKey, result, read };
}

beforeEach(() => {
  initiativeProjectsPost.mockReset().mockResolvedValue(okResponse({}));
  initiativeProjectDelete.mockReset().mockResolvedValue(okResponse({}));
  projectPatch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useProjectMutations — project field edits', () => {
  it('shows the new name and health before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    projectPatch.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchProject({ name: 'Launch checklist v2', health: 'at_risk' });
    });

    await waitFor(() => {
      expect(read()?.project?.name).toBe('Launch checklist v2');
    });
    expect(read()?.project?.health).toBe('at_risk');
    // The request has not answered yet — the UI is ahead of the server, which is the point.
    expect(projectPatch).toHaveBeenCalledTimes(1);
    expect(result.current.propsPending).toBe(true);

    pending.resolve(
      okResponse({ ...baseDetail().project, name: 'Launch checklist v2', health: 'at_risk' }),
    );
    await waitFor(() => {
      expect(result.current.propsPending).toBe(false);
    });
  });

  it('shows a new target date before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    projectPatch.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchProject({ targetDate: '2026-09-30' });
    });

    await waitFor(() => {
      expect(read()?.project?.targetDate).toBe('2026-09-30');
    });

    pending.resolve(okResponse({ ...baseDetail().project, targetDate: '2026-09-30' }));
    await waitFor(() => {
      expect(result.current.propsPending).toBe(false);
    });
  });

  it('reverts every edited field and surfaces application-owned copy on failure', async () => {
    projectPatch.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchProject({
        name: 'Launch checklist v2',
        health: 'off_track',
        targetDate: '2026-09-30',
      });
    });

    await waitFor(() => {
      expect(result.current.propsError).not.toBeNull();
    });
    // A partial rollback would be worse than none: the whole patch is one edit, so it reverts as one.
    expect(read()?.project?.name).toBe('Launch checklist');
    expect(read()?.project?.health).toBe('on_track');
    expect(read()?.project?.targetDate).toBeNull();
    expect(result.current.propsError).toBe('Could not update the project.');
    expect(result.current.propsError).not.toContain('ECONNREFUSED');
    expect(result.current.propsError).not.toContain('pg pool');
  });
});

describe('useProjectMutations — initiative field edits', () => {
  it('shows the newly linked initiative before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    initiativeProjectsPost.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      result.current.setInitiatives([INITIATIVE_ID]);
    });

    await waitFor(() => {
      expect(read()?.initiativeIds).toEqual([INITIATIVE_ID]);
    });
    expect(result.current.propsPending).toBe(true);

    pending.resolve(okResponse({}));
    await waitFor(() => {
      expect(result.current.propsPending).toBe(false);
    });
  });

  it('restores the previous links and surfaces application-owned copy on failure', async () => {
    initiativeProjectsPost.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { result, read } = mountMutations([INITIATIVE_ID]);

    act(() => {
      result.current.setInitiatives([INITIATIVE_ID, OTHER_INITIATIVE_ID]);
    });

    await waitFor(() => {
      expect(result.current.propsError).not.toBeNull();
    });
    expect(read()?.initiativeIds).toEqual([INITIATIVE_ID]);
    // `unwrap`'s own fallback wins over the hook's, because the failure is already a
    // `UserFacingError` by the time `propsError` reads it — both strings are application-owned, and
    // the narrower one is the more accurate description of what failed.
    expect(result.current.propsError).toBe('Could not update the association.');
    expect(result.current.propsError).not.toContain('ECONNREFUSED');
    expect(result.current.propsError).not.toContain('pg pool');
  });
});

describe('useProjectMutations.setInitiatives', () => {
  it('actually calls the link API when an initiative is newly selected, and keeps it selected', async () => {
    const { client, wrapper } = makeWrapper();
    const detailKey = queryKeys.project(ORG_ID, PROJECT_ID);
    client.setQueryData<ProjectDetailData>(detailKey, {
      initiativeIds: [],
    } as unknown as ProjectDetailData);

    const { result } = renderHook(() => useProjectMutations(ORG_ID, PROJECT_ID), { wrapper });

    act(() => {
      result.current.setInitiatives([INITIATIVE_ID]);
    });

    await waitFor(() => {
      expect(initiativeProjectsPost).toHaveBeenCalledTimes(1);
    });
    expect(initiativeProjectsPost).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: INITIATIVE_ID },
      json: { projectId: PROJECT_ID },
    });
    expect(initiativeProjectDelete).not.toHaveBeenCalled();

    // The optimistic cache write must stick — no snap-back to the pre-toggle empty list.
    await waitFor(() => {
      expect(client.getQueryData<ProjectDetailData>(detailKey)?.initiativeIds).toEqual([
        INITIATIVE_ID,
      ]);
    });
  });

  it('calls the unlink API when a previously-selected initiative is deselected', async () => {
    const { client, wrapper } = makeWrapper();
    const detailKey = queryKeys.project(ORG_ID, PROJECT_ID);
    client.setQueryData<ProjectDetailData>(detailKey, {
      initiativeIds: [INITIATIVE_ID],
    } as unknown as ProjectDetailData);

    const { result } = renderHook(() => useProjectMutations(ORG_ID, PROJECT_ID), { wrapper });

    act(() => {
      result.current.setInitiatives([]);
    });

    await waitFor(() => {
      expect(initiativeProjectDelete).toHaveBeenCalledTimes(1);
    });
    expect(initiativeProjectDelete).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: INITIATIVE_ID, projectId: PROJECT_ID },
    });
    expect(initiativeProjectsPost).not.toHaveBeenCalled();
  });
});
