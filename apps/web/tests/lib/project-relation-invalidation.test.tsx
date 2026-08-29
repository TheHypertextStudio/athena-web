import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProgramProjects } from '../../src/lib/use-program-projects';
import { useProjectDependencies } from '../../src/lib/use-project-dependencies';
import { makeQueryWrapper, okResponse } from '../support/query';

const {
  getDependencies,
  addDependency,
  removeDependency,
  patchProject,
  invalidateWorkTargetQueries,
} = vi.hoisted(() => ({
  getDependencies: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  patchProject: vi.fn(),
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          projects: {
            ':id': {
              $patch: patchProject,
              dependencies: {
                $get: getDependencies,
                $post: addDependency,
                ':depId': { $delete: removeDependency },
              },
            },
          },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

const PROGRAM_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PROJECT_ORGANIZATION_ID = PROGRAM_ORGANIZATION_ID;
const PROGRAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const OTHER_PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';

beforeEach(() => {
  vi.clearAllMocks();
  getDependencies.mockResolvedValue(okResponse({ blocking: [], blockedBy: [] }));
  addDependency.mockResolvedValue(okResponse({ created: true }));
  removeDependency.mockResolvedValue(okResponse({}));
  patchProject.mockResolvedValue(okResponse({ id: PROJECT_ID }));
});

describe('useProjectDependencies', () => {
  it.each(['add', 'remove'] as const)(
    'refreshes Project projections after %s',
    async (operation) => {
      const { client, wrapper } = makeQueryWrapper();
      const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
      const { result } = renderHook(
        () =>
          useProjectDependencies(PROJECT_ORGANIZATION_ID, PROJECT_ID, [
            'org',
            PROJECT_ORGANIZATION_ID,
            'projects',
            PROJECT_ID,
          ]),
        { wrapper },
      );

      act(() => {
        if (operation === 'add') result.current.add('blocking', OTHER_PROJECT_ID);
        else result.current.remove(OTHER_PROJECT_ID);
      });

      await waitFor(() => {
        expect(operation === 'add' ? addDependency : removeDependency).toHaveBeenCalledOnce();
        expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
          target: 'project',
          ownerOrganizationId: PROJECT_ORGANIZATION_ID,
        });
      });
      expect(invalidateQueries).not.toHaveBeenCalled();
    },
  );
});

describe('useProgramProjects', () => {
  it.each(['attach', 'detach'] as const)(
    'writes a same-owner Project and refreshes Project and Program after %s',
    async (operation) => {
      const { client, wrapper } = makeQueryWrapper();
      const { result } = renderHook(() => useProgramProjects(PROGRAM_ORGANIZATION_ID, PROGRAM_ID), {
        wrapper,
      });

      act(() => {
        result.current[operation](PROJECT_ID);
      });

      await waitFor(() => {
        expect(patchProject).toHaveBeenCalledWith({
          param: { orgId: PROJECT_ORGANIZATION_ID, id: PROJECT_ID },
          json: { programId: operation === 'attach' ? PROGRAM_ID : null },
        });
        expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
      });
      expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
        target: 'project',
        ownerOrganizationId: PROJECT_ORGANIZATION_ID,
      });
      expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
        target: 'program',
        ownerOrganizationId: PROGRAM_ORGANIZATION_ID,
      });
    },
  );
});
