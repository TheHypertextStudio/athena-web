/**
 * Behavior tests for {@link useMilestonePage} — the Milestone detail page's reads.
 *
 * @remarks
 * The sequencing is the thing worth pinning. A milestone's Project is only known once the milestone
 * itself resolves, so the Project reads must stay dormant until then rather than firing against an
 * empty id; and the tasks come from the Project's work read narrowed to this milestone, because
 * there is no `milestoneId` filter on the task list.
 */
import { MilestoneId, ProjectId, TaskId } from '@docket/work/ids';
import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { milestoneGet, projectGet, workGet, membersGet, rolesGet } = vi.hoisted(() => ({
  milestoneGet: vi.fn(),
  projectGet: vi.fn(),
  workGet: vi.fn(),
  membersGet: vi.fn(),
  rolesGet: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          milestones: { ':id': { $get: milestoneGet } },
          projects: { ':id': Object.assign({ $get: projectGet }, { work: { $get: workGet } }) },
          members: { $get: membersGet },
          roles: { $get: rolesGet },
        },
      },
    },
  },
}));

vi.mock('../../../src/components/entity-display/use-work-status', () => ({
  useCategoryOf: () => (state: string) => (state === 'done' ? 'completed' : 'started'),
}));

import { useMilestonePage } from '../../../src/components/milestone-detail/use-milestone-page';

const ORG_ID = OrganizationId.parse('01HZZZ0000000000000000000G');
const PROJECT_ID = ProjectId.parse('01HZZZ0000000000000000000P');
const TEAM_ID = TeamId.parse('01HZZZ0000000000000000000T');
const MILESTONE_ID = MilestoneId.parse('01HZZZ000000000000000000M1');
const OTHER_MILESTONE = MilestoneId.parse('01HZZZ000000000000000000M2');
const TASK_1 = TaskId.parse('01HZZZ00000000000000000TK1');
const TASK_2 = TaskId.parse('01HZZZ00000000000000000TK2');
const TASK_3 = TaskId.parse('01HZZZ00000000000000000TK3');

/** A `Response`-like stub whose `ok`/`status`/`json()` `unwrap` reads. */
function jsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response;
}

/** A minimal task fixture. */
function task(id: string, state: string) {
  return {
    labels: [],
    id,
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    title: 'T',
    state,
    priority: 'none',
    autoCompletedBySubtasks: false,
    provenance: { source: 'native' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  membersGet.mockResolvedValue(jsonResponse(true, { items: [] }));
  rolesGet.mockResolvedValue(jsonResponse(true, { items: [] }));
  projectGet.mockResolvedValue(jsonResponse(true, { id: PROJECT_ID, name: 'Atlas' }));
  workGet.mockResolvedValue(
    jsonResponse(true, {
      tasks: [task(TASK_1, 'done'), task(TASK_2, 'backlog'), task(TASK_3, 'backlog')],
      taskMilestones: [
        { taskId: TASK_1, milestoneId: MILESTONE_ID },
        { taskId: TASK_2, milestoneId: MILESTONE_ID },
        { taskId: TASK_3, milestoneId: OTHER_MILESTONE },
      ],
      milestones: [],
    }),
  );
  milestoneGet.mockResolvedValue(
    jsonResponse(true, {
      id: MILESTONE_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      name: 'Beta',
      description: null,
      targetDate: '2026-03-14T00:00:00.000Z',
      sort: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMilestonePage', () => {
  it('narrows the Project work read to the tasks pointing at this milestone', async () => {
    const { result } = renderHook(() => useMilestonePage(ORG_ID, MILESTONE_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(2);
    });
    expect(result.current.tasks.map((entry) => entry.task.id)).toEqual([TASK_1, TASK_2]);
    // The third task belongs to another milestone and must not count toward this one.
    expect(result.current.progress).toEqual({ done: 1, total: 2 });
  });

  it('normalizes the stored timestamp to a calendar day', async () => {
    const { result } = renderHook(() => useMilestonePage(ORG_ID, MILESTONE_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.targetDate).toBe('2026-03-14');
    });
  });

  it('names the owning Project for the breadcrumb', async () => {
    const { result } = renderHook(() => useMilestonePage(ORG_ID, MILESTONE_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.projectName).toBe('Atlas');
    });
    expect(result.current.projectId).toBe(PROJECT_ID);
  });

  it('leaves the Project reads dormant while the milestone is unreadable', async () => {
    milestoneGet.mockResolvedValue(jsonResponse(false, { detail: 'gone' }, 404));
    const { result } = renderHook(() => useMilestonePage(ORG_ID, MILESTONE_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    // `projectId` is only known from the milestone, so neither dependent read may have fired.
    expect(projectGet).not.toHaveBeenCalled();
    expect(workGet).not.toHaveBeenCalled();
    expect(result.current.milestone).toBeNull();
  });

  it('reports a failed work read without failing the page', async () => {
    workGet.mockResolvedValue(jsonResponse(false, { detail: 'nope' }));
    const { result } = renderHook(() => useMilestonePage(ORG_ID, MILESTONE_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.tasksFailed).toBe(true);
    });
    // The milestone itself still read, so the page renders — only its task list is missing.
    expect(result.current.error).toBeNull();
    expect(result.current.milestone?.name).toBe('Beta');
    expect(result.current.progress).toEqual({ done: 0, total: 0 });
  });
});
