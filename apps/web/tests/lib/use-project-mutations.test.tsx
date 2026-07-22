/**
 * Behavior tests for {@link useProjectMutations}'s initiative-association toggle.
 *
 * @remarks
 * Regression coverage for a bug where selecting an initiative appeared to "add then immediately
 * unadd" itself: the mutation diffed the toggle against `queryClient.getQueryData(detailKey)`
 * inside `mutationFn`, but by the time `mutationFn` ran, `onMutate` had already optimistically
 * overwritten that same cache entry with the *next* state — so the diff against "current" always
 * computed empty adds/removes, no API call fired, and the later cache invalidation snapped the UI
 * back to the pre-toggle list.
 */
import { OrganizationId, ProjectId } from '@docket/types';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { initiativeProjectsPost, initiativeProjectDelete } = vi.hoisted(() => ({
  initiativeProjectsPost: vi.fn(),
  initiativeProjectDelete: vi.fn(),
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
          projects: { ':id': { $patch: vi.fn() } },
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

/** Return a typed mock Hono response for the mutation unwrap layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
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

beforeEach(() => {
  initiativeProjectsPost.mockReset().mockResolvedValue(okResponse({}));
  initiativeProjectDelete.mockReset().mockResolvedValue(okResponse({}));
});

afterEach(() => {
  cleanup();
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
