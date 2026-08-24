import type { TaskOut } from '@docket/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  triageQueue: [] as TaskOut[],
  mine: [] as TaskOut[],
  delegated: [] as TaskOut[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/app-location', () => ({ useTypedRoute: () => ({ params: { orgId: 'org-1' } }) }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } } }) }));
vi.mock('@/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: vi.fn() }),
}));
vi.mock('@/components/entity-display/use-work-status', () => ({
  useCategoryOf: () => () => 'unstarted',
}));
vi.mock('@/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({
    statusOf: (_entityType: string, key: string) => ({
      name: key === 'todo' ? 'Ready queue' : key,
    }),
  }),
}));
vi.mock('@/components/triage/suggestions-lane', () => ({
  default: () => <aside>Suggestions</aside>,
}));
vi.mock('@/components/triage/triage-row', () => ({
  TriageRow: ({ task }: { task: { title: string } }) => <div>{task.title}</div>,
}));
vi.mock('@/components/my-work/agent-task-row', () => ({
  AgentTaskRow: ({ task }: { task: { title: string } }) => <div>{task.title}</div>,
}));
vi.mock('@/lib/use-triage', () => ({
  useTriage: () => ({
    queue: harness.triageQueue,
    loading: false,
    loadError: null,
    actionError: null,
    pending: new Set<string>(),
    projectDestinations: [],
    programDestinations: [],
    providerName: () => 'GitHub',
    canEdit: false,
    rename: vi.fn(),
    toRow: (task: TaskOut) => ({
      id: task.id,
      title: task.title,
      stateType: 'unstarted',
      provenance: task.provenance,
      assigneeName: task.assigneeId === 'owner-needle' ? 'Needle Owner' : 'Queue Owner',
      assigneeAvatarUrl: null,
    }),
    groupBy: (task: TaskOut) => ({
      id: task.teamId,
      label: task.teamId === 'team-needle' ? 'Needle Team' : 'Queue Team',
    }),
    sortToProject: vi.fn(),
    sortToProgram: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock('@/lib/use-my-work', () => ({
  useMyWork: () => ({
    setTasks: vi.fn(),
    loading: false,
    loadError: null,
    myActorId: 'actor-me',
    counts: { mine: harness.mine.length, delegated: harness.delegated.length },
    pendingApprovals: 0,
    visibleTasks: (tab: 'mine' | 'delegated') =>
      tab === 'mine' ? harness.mine : harness.delegated,
    actorName: (actorId: string | null | undefined) =>
      actorId === 'owner-needle' ? 'Needle Assignee' : null,
    toRow: (task: TaskOut) => ({
      id: task.id,
      title: task.title,
      stateType: 'unstarted',
      actor: { name: task.assigneeId === 'owner-needle' ? 'Needle Agent' : 'Queue Owner' },
      session: task.id === 'task-needle' ? { status: 'awaiting_approval', href: '/task' } : null,
    }),
    groupBy: (task: TaskOut) =>
      task.projectId ? { id: task.projectId, label: 'Needle Project' } : null,
    subGroupBy: () => ({ id: 'unstarted', label: 'Todo', stateType: 'unstarted' }),
    canEdit: false,
    rename: vi.fn(),
  }),
}));
import MyWorkClient from '@/app/(app)/orgs/[orgId]/my-work/my-work-client';
import TriagePage from '@/app/(app)/orgs/[orgId]/triage/page';
import { InPageSearchProvider } from '@/components/in-page-search/in-page-search-provider';

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 40;
let heightDescriptor: PropertyDescriptor | undefined;
let widthDescriptor: PropertyDescriptor | undefined;
let boundingRectDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  boundingRectDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'getBoundingClientRect',
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => ROW_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
  HTMLElement.prototype.getBoundingClientRect = (): DOMRect => ({
    width: 800,
    height: VIEWPORT_HEIGHT,
    top: 0,
    left: 0,
    bottom: VIEWPORT_HEIGHT,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterAll(() => {
  if (heightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
  }
  if (widthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
  }
  if (boundingRectDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', boundingRectDescriptor);
  }
});

function task(index: number, needle = false): TaskOut {
  return {
    id: (needle ? 'task-needle' : `task-${String(index)}`) as TaskOut['id'],
    organizationId: 'org-1' as TaskOut['organizationId'],
    teamId: (needle ? 'team-needle' : 'team-queue') as TaskOut['teamId'],
    title: needle ? 'Offscreen needle' : `Queue item ${String(index)}`,
    state: 'todo',
    priority: 'none',
    assigneeId: needle ? ('owner-needle' as NonNullable<TaskOut['assigneeId']>) : undefined,
    projectId: needle ? ('project-needle' as NonNullable<TaskOut['projectId']>) : undefined,
    labels: [],
    provenance: needle
      ? { source: 'linked', sourceIntegrationId: 'integration-1' }
      : { source: 'native' },
    createdAt: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  };
}

beforeEach(() => {
  const collection = [...Array.from({ length: 120 }, (_, index) => task(index)), task(121, true)];
  harness.triageQueue = collection;
  harness.mine = collection;
  harness.delegated = [task(200)];
});

afterEach(cleanup);

describe('virtualized task page in-page search', () => {
  it('finds a Triage item through its offscreen title, provider, team, and assignee text', () => {
    render(
      <InPageSearchProvider>
        <TriagePage />
      </InPageSearchProvider>,
    );

    const browseGrid = screen.getByRole('grid', { name: 'Triage queue, grouped by team' });
    expect(browseGrid.querySelectorAll('[role="row"]').length).toBeLessThan(121);
    expect(screen.queryByText('Offscreen needle')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const field = screen.getByRole('searchbox', { name: 'Search the triage queue' });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: 'needle github owner team' } });

    expect(screen.getByText('Offscreen needle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Queue item 0')).toBeInTheDocument();
  });

  it('searches only the active My Work tab and resets the query when the tab changes', () => {
    render(
      <InPageSearchProvider>
        <MyWorkClient />
      </InPageSearchProvider>,
    );

    const browseGrid = screen.getByRole('grid', { name: 'Tasks assigned to me' });
    expect(browseGrid.querySelectorAll('[role="row"]').length).toBeLessThan(121);
    expect(screen.queryByText('Offscreen needle')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const field = screen.getByRole('searchbox', { name: 'Search My Work' });
    fireEvent.change(field, {
      target: { value: 'needle project agent assignee ready needs' },
    });
    expect(screen.getByText('Offscreen needle')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Delegated & approvals/ }));
    expect(field).toHaveValue('');
    expect(screen.getByText('Queue item 200')).toBeInTheDocument();
  });
});
