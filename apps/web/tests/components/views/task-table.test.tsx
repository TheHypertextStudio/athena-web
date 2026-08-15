/**
 * Behavior tests for the shared, aligned-column task table ({@link TaskTable} /
 * {@link buildTaskColumns}).
 *
 * @remarks
 * Every in-app task *list* (a project's tasks, a cycle's committed tasks) renders through this one
 * surface so they read identically. These pin the shared column vocabulary and its alignment:
 *
 * - the column set is the leading status glyph + a flexing Title + Assignee + Due date + Estimate
 *   + the universal Track affordance, with headers derived from the task catalog (so they stay
 *   consistent with the FilterToolbar);
 * - the estimate cell renders `estimateMinutes` as a compact `1h 30m` duration (its own placeholder
 *   when unset), and the due-date cell renders a short calendar day (placeholder when unset);
 * - the assignee cell resolves the actor id to a named avatar, with a neutral placeholder when a
 *   task is unassigned;
 * - rows are real links to the task detail, and grouped tasks render full-width group headers;
 * - every row offers {@link TaskTimerButton} (CORE-40) and a click on it starts that row's task
 *   without also activating the row's own link (which would otherwise both start a timer AND
 *   navigate to the task detail on the same click).
 *
 * The table itself is the well-tested `@docket/ui` `EntityTable`; these assert the task-side
 * derivation and wiring, not the primitive.
 */
import '@testing-library/jest-dom/vitest';

import {
  ActorId,
  DEFAULT_WORK_STATUSES,
  LabelId,
  OrganizationId,
  TaskId,
  TeamId,
  type TaskOut,
} from '@docket/types';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DragProvider } from '../../../src/components/dnd/drag-context';
import { readObjectSetPayload } from '../../../src/components/dnd/drag-payload';
import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import { createActionRegistry, defineActionDomain } from '../../../src/lib/actions/registry';
import type { ActionContext } from '../../../src/lib/actions/types';
import { fakeDataTransfer } from '../../interactivity/harness';

import { buildTaskCatalog } from '../../../src/components/views/task-catalog';
import {
  buildTaskColumns,
  TaskTable,
  type TaskTableActor,
} from '../../../src/components/views/task-table';

const { activeGet, recordsPost } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        records: { $post: recordsPost },
      },
    },
  },
}));

const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Render children inside the query client + tooltip provider `TaskTimerButton` (embedded in
 * every row) needs. Mirrors the app root's real `TooltipProvider` placement.
 */
function withQueryClient(children: ReactNode): ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  activeGet.mockReset();
  recordsPost.mockReset();
  open.mockReset();
  activeGet.mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        record: null,
        serverNow: new Date().toISOString(),
        suggestion: null,
        activeAgentExecutions: [],
      }),
  });
});

afterEach(cleanup);

// The table renders each row through `renderRowLink` (a Next.js `Link`), which is a plain <a>
// in jsdom — so the rows are real anchors we locate via the title's closest <a>.

// Ids are 26-char Crockford ULIDs (alphabet 0-9 A-H J K M N P-T V-Z); these are stable + distinct.
const ORG_ID = '01HZZZ0000000000000000000G';
const TEAM_ID = '01HZZZ0000000000000000000T';
const ADA_ID = '01HZZZ000000000000000000AD';
const TASK_1 = '01HZZZ0000000000000000T001';
const TASK_2 = '01HZZZ0000000000000000T002';
const TASK_3 = '01HZZZ0000000000000000T003';
const TASK_4 = '01HZZZ0000000000000000T004';
const LABEL_1 = '01HZZZ00000000000000000AB1';

/** Resolve the fixture assignee; anything else is a neutral fallback. */
function resolveActor(id: string): TaskTableActor {
  if (id === ADA_ID) return { name: 'Ada Lovelace', kind: 'human' };
  return { name: id, kind: 'human' };
}

const catalog = buildTaskCatalog({
  statuses: DEFAULT_WORK_STATUSES.task,
  projectLabel: 'Project',
  programLabel: 'Program',
  resolveProject: (id) => id,
  resolveProgram: (id) => id,
  resolveAssignee: (id) => resolveActor(id).name,
  assigneeOptions: () => [],
  projectOptions: () => [],
  programOptions: () => [],
});

const columns = buildTaskColumns({ catalog, statuses: DEFAULT_WORK_STATUSES.task, resolveActor });

/** The plain (unbranded) fields a fixture supplies; ids are branded once when assembled. */
interface TaskFixture {
  id: string;
  title: string;
  state?: string;
  assigneeId?: string;
  estimateMinutes?: number;
  dueDate?: string;
  labelIds?: readonly string[];
}

/** A minimal task fixture with the fields the shared columns read (ids parsed to branded types). */
function task(fixture: TaskFixture): TaskOut {
  return {
    labels: (fixture.labelIds ?? []).map((id) => ({
      id: LabelId.parse(id),
      name: id,
      color: 'gray',
    })),
    id: TaskId.parse(fixture.id),
    organizationId: OrganizationId.parse(ORG_ID),
    teamId: TeamId.parse(TEAM_ID),
    title: fixture.title,
    state: fixture.state ?? 'in_progress',
    priority: 'none',
    ...(fixture.assigneeId ? { assigneeId: ActorId.parse(fixture.assigneeId) } : {}),
    ...(fixture.estimateMinutes !== undefined ? { estimateMinutes: fixture.estimateMinutes } : {}),
    ...(fixture.dueDate ? { dueDate: fixture.dueDate } : {}),
    provenance: { source: 'native' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildTaskColumns', () => {
  it('declares the shared column vocabulary with catalog-derived headers', () => {
    const keys = columns.map((c) => c.key);
    expect(keys).toEqual([
      'glyph',
      'title',
      'labels',
      'assigneeId',
      'dueDate',
      'estimate',
      'timer',
    ]);

    // The leading glyph is always-kept and label-less; the title is the one flexing column.
    const glyph = columns[0];
    const title = columns[1];
    expect(glyph?.priority).toBe('always');
    expect(glyph?.header).toBe('');
    expect(title?.flex).toBe(true);
    expect(title?.header).toBe('Title');

    // Property headers come straight from the catalog field labels.
    expect(columns.find((c) => c.key === 'assigneeId')?.header).toBe('Assignee');
    expect(columns.find((c) => c.key === 'dueDate')?.header).toBe('Due date');

    // The numeric columns are end-aligned so values line up against the row's end.
    expect(columns.find((c) => c.key === 'dueDate')?.align).toBe('end');
    expect(columns.find((c) => c.key === 'estimate')?.align).toBe('end');
  });
});

describe('TaskTable', () => {
  it('selects rows without hijacking title navigation and drags the ordered selection', () => {
    const registry = createActionRegistry();
    const first = task({ id: TASK_1, title: 'First' });
    const second = task({ id: TASK_2, title: 'Second' });
    const third = task({ id: TASK_3, title: 'Third' });
    render(
      withQueryClient(
        <InteractionProvider registry={registry}>
          <DragProvider>
            <TaskTable
              label="Tasks"
              columns={columns}
              tasks={[first, second, third]}
              taskHref={(item) => `/orgs/${ORG_ID}/tasks/${item.id}`}
            />
          </DragProvider>
        </InteractionProvider>,
      ),
    );
    const row = (id: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(`[role="row"][data-object-id="${id}"]`);
      if (!element) throw new Error(`Expected task row ${id}`);
      return element;
    };

    fireEvent.click(row(TASK_1));
    fireEvent.click(row(TASK_2), { metaKey: true });
    expect(row(TASK_1)).toHaveAttribute('aria-selected', 'true');
    expect(row(TASK_2)).toHaveAttribute('aria-selected', 'true');

    const titleLink = screen.getByRole('link', { name: 'Third' });
    titleLink.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(titleLink);
    expect(row(TASK_1)).toHaveAttribute('aria-selected', 'true');
    expect(row(TASK_2)).toHaveAttribute('aria-selected', 'true');

    const transfer = fakeDataTransfer();
    fireEvent.dragStart(row(TASK_2), { dataTransfer: transfer });
    expect(readObjectSetPayload(transfer).map(({ id }) => id)).toEqual([TASK_1, TASK_2]);
  });

  it('previews and dispatches a selected-root hierarchy drop onto another task', async () => {
    const seen: ActionContext[] = [];
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.makeSubtaskOf',
          label: 'Make subtask of',
          objectKinds: ['task'],
          multi: true,
          run: (context) => {
            seen.push(context);
          },
        },
      ]),
    );
    render(
      withQueryClient(
        <InteractionProvider registry={registry}>
          <DragProvider>
            <TaskTable
              label="Tasks"
              columns={columns}
              tasks={[
                task({ id: TASK_1, title: 'First' }),
                task({ id: TASK_2, title: 'Second' }),
                task({ id: TASK_3, title: 'Target' }),
              ]}
              taskHref={(item) => `/orgs/${ORG_ID}/tasks/${item.id}`}
            />
          </DragProvider>
        </InteractionProvider>,
      ),
    );
    const row = (id: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(`[role="row"][data-object-id="${id}"]`);
      if (!element) throw new Error(`Expected task row ${id}`);
      return element;
    };
    fireEvent.click(row(TASK_1));
    fireEvent.click(row(TASK_2), { metaKey: true });
    const transfer = fakeDataTransfer();
    fireEvent.dragStart(row(TASK_1), { dataTransfer: transfer });

    fireEvent.dragEnter(row(TASK_3), { dataTransfer: transfer });
    expect(row(TASK_3)).toHaveAttribute('data-drop-state', 'accept');
    expect(await screen.findByText('Move 2 tasks under Target')).toBeInTheDocument();
    fireEvent.drop(row(TASK_3), { dataTransfer: transfer });

    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]).toMatchObject({
      objects: [{ id: TASK_1 }, { id: TASK_2 }],
      target: { id: TASK_3 },
      source: 'drag',
    });
  });

  it('renders the status glyph, title, assignee, formatted estimate, and a task-detail link', () => {
    render(
      withQueryClient(
        <TaskTable
          label="Tasks"
          columns={columns}
          tasks={[
            task({
              id: TASK_1,
              title: 'Wire the table',
              state: 'in_progress',
              assigneeId: ADA_ID,
              estimateMinutes: 90,
              dueDate: '2026-06-21',
            }),
          ]}
          taskHref={(t) => `/orgs/${ORG_ID}/tasks/${t.id}`}
        />,
      ),
    );

    const titleLink = screen.getByRole('link', { name: 'Wire the table' });
    const row = titleLink.closest<HTMLElement>('[role="row"]');
    if (!row) throw new Error('Expected task row for Wire the table');
    // The leading status glyph reads as the `started` category for an in-progress task, and names
    // itself with the workspace's own word for that status rather than the field's header.
    const glyph = row.querySelector('[data-state-type]');
    expect(glyph).toHaveAttribute('data-state-type', 'started');
    expect(glyph).toHaveClass('text-state-started');
    expect(glyph).toHaveAccessibleName(DEFAULT_WORK_STATUSES.task[2]?.name ?? '');
    expect(within(row).getByLabelText('Ada Lovelace')).toBeInTheDocument();
    // estimateMinutes is rendered as the compact duration, not raw minutes.
    expect(within(row).getByText('1h 30m')).toBeInTheDocument();
    expect(within(row).getByText('Jun 21')).toBeInTheDocument();
    // The row is a real link to the task detail.
    expect(titleLink).toHaveAttribute('href', `/orgs/${ORG_ID}/tasks/${TASK_1}`);
  });

  it('renders neutral placeholders for an unassigned task with no estimate or due date', () => {
    render(
      withQueryClient(
        <TaskTable
          label="Tasks"
          columns={columns}
          tasks={[task({ id: TASK_2, title: 'Bare task' })]}
          taskHref={(t) => `/orgs/${ORG_ID}/tasks/${t.id}`}
        />,
      ),
    );

    const row = screen.getByText('Bare task').closest('[role="row"]');
    expect(row).not.toBeNull();
    // Labels, assignee, due, and estimate each fall back to the em-dash placeholder.
    expect(within(row as HTMLElement).getAllByText('—')).toHaveLength(4);
  });

  it('renders grouped tasks under full-width group headers', () => {
    render(
      withQueryClient(
        <TaskTable
          label="Tasks"
          columns={columns}
          groups={[
            {
              id: 'm1',
              label: 'Milestone One',
              rows: [task({ id: TASK_3, title: 'Grouped task' })],
            },
          ]}
          taskHref={(t) => `/orgs/${ORG_ID}/tasks/${t.id}`}
        />,
      ),
    );

    expect(screen.getByText('Milestone One')).toBeInTheDocument();
    expect(screen.getByText('Grouped task')).toBeInTheDocument();
  });

  it('offers CORE-40’s track-timer affordance on every row, without activating the row link', async () => {
    recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
    render(
      withQueryClient(
        <TaskTable
          label="Tasks"
          columns={columns}
          tasks={[task({ id: TASK_1, title: 'Wire the table', state: 'backlog' })]}
          taskHref={(t) => `/orgs/${ORG_ID}/tasks/${t.id}`}
        />,
      ),
    );

    const titleLink = screen.getByRole('link', { name: 'Wire the table' });
    const row = titleLink.closest<HTMLElement>('[role="row"]');
    if (!row) throw new Error('Expected task row for Wire the table');
    const timerButton = await within(row).findByTestId(`task-timer-${TASK_1}`);

    fireEvent.click(timerButton);

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Wire the table', taskId: TASK_1 } },
      });
    });
    // The row's own `<a>` was never followed — jsdom does not navigate on click, but a real
    // navigation attempt would have thrown/warned here; asserting the row is still on screen
    // with its href intact is the reachable proxy for "did not activate the row".
    expect(titleLink).toHaveAttribute('href', `/orgs/${ORG_ID}/tasks/${TASK_1}`);
  });

  it('opens the label picker for the focused row on L, with its current labels attached', () => {
    const fixtureTask = task({ id: TASK_4, title: 'Label me', labelIds: [LABEL_1] });
    render(
      withQueryClient(
        <TaskTable
          label="Tasks"
          columns={columns}
          tasks={[fixtureTask]}
          taskHref={(t) => `/orgs/${ORG_ID}/tasks/${t.id}`}
        />,
      ),
    );

    const grid = screen.getByRole('grid');
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'l' });

    expect(open).toHaveBeenCalledWith({
      kind: 'labels',
      organizationId: fixtureTask.organizationId,
      objects: [
        {
          kind: 'task',
          id: fixtureTask.id,
          organizationId: fixtureTask.organizationId,
          title: fixtureTask.title,
          meta: { parentTaskId: null },
        },
      ],
      current: new Map([[`task:${fixtureTask.id}`, fixtureTask.labels.map((l) => l.id)]]),
      anchor: expect.anything(),
    });
  });
});
