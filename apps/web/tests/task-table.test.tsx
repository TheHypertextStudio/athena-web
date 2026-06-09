/**
 * Behavior tests for the shared, aligned-column task table ({@link TaskTable} /
 * {@link buildTaskColumns}).
 *
 * @remarks
 * Every in-app task *list* (a project's tasks, a cycle's committed tasks) renders through this one
 * surface so they read identically. These pin the shared column vocabulary and its alignment:
 *
 * - the column set is the leading status glyph + a flexing Title + Assignee + Due date + Estimate,
 *   with headers derived from the task catalog (so they stay consistent with the FilterToolbar);
 * - the estimate cell renders `estimateMinutes` as a compact `1h 30m` duration (its own placeholder
 *   when unset), and the due-date cell renders a short calendar day (placeholder when unset);
 * - the assignee cell resolves the actor id to a named avatar, with a neutral placeholder when a
 *   task is unassigned;
 * - rows are real links to the task detail, and grouped tasks render full-width group headers.
 *
 * The table itself is the well-tested `@docket/ui` `EntityTable`; these assert the task-side
 * derivation and wiring, not the primitive.
 */
import '@testing-library/jest-dom/vitest';

import { ActorId, OrganizationId, TaskId, TeamId, type TaskOut } from '@docket/types';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTaskCatalog } from '../src/components/views/task-catalog';
import {
  buildTaskColumns,
  TaskTable,
  type TaskTableActor,
} from '../src/components/views/task-table';

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

/** Resolve the fixture assignee; anything else is a neutral fallback. */
function resolveActor(id: string): TaskTableActor {
  if (id === ADA_ID) return { name: 'Ada Lovelace', kind: 'human' };
  return { name: id, kind: 'human' };
}

const catalog = buildTaskCatalog({
  projectLabel: 'Project',
  programLabel: 'Program',
  resolveProject: (id) => id,
  resolveProgram: (id) => id,
  resolveAssignee: (id) => resolveActor(id).name,
  assigneeOptions: () => [],
  projectOptions: () => [],
  programOptions: () => [],
});

const columns = buildTaskColumns({ catalog, resolveActor });

/** The plain (unbranded) fields a fixture supplies; ids are branded once when assembled. */
interface TaskFixture {
  id: string;
  title: string;
  state?: string;
  assigneeId?: string;
  estimateMinutes?: number;
  dueDate?: string;
}

/** A minimal task fixture with the fields the shared columns read (ids parsed to branded types). */
function task(fixture: TaskFixture): TaskOut {
  return {
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
    expect(keys).toEqual(['glyph', 'title', 'assigneeId', 'dueDate', 'estimate']);

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
  it('renders the status glyph, title, assignee, formatted estimate, and a task-detail link', () => {
    render(
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
    );

    const row = screen.getByText('Wire the table').closest('a') as HTMLElement;
    expect(row).not.toBeNull();
    // The leading status glyph reads as the canonical "started" type for an in-progress task.
    expect(within(row).getByRole('img', { name: 'Status' })).toHaveClass('text-state-started');
    expect(within(row).getByLabelText('Ada Lovelace')).toBeInTheDocument();
    // estimateMinutes is rendered as the compact duration, not raw minutes.
    expect(within(row).getByText('1h 30m')).toBeInTheDocument();
    expect(within(row).getByText('Jun 21')).toBeInTheDocument();
    // The row is a real link to the task detail.
    expect(row).toHaveAttribute('href', `/orgs/${ORG_ID}/tasks/${TASK_1}`);
  });

  it('renders neutral placeholders for an unassigned task with no estimate or due date', () => {
    render(
      <TaskTable
        label="Tasks"
        columns={columns}
        tasks={[task({ id: TASK_2, title: 'Bare task' })]}
        taskHref={(t) => `/orgs/${ORG_ID}/tasks/${t.id}`}
      />,
    );

    const row = screen.getByText('Bare task').closest('a');
    expect(row).not.toBeNull();
    // Assignee, due, and estimate each fall back to the em-dash placeholder.
    expect(within(row as HTMLElement).getAllByText('—')).toHaveLength(3);
  });

  it('renders grouped tasks under full-width group headers', () => {
    render(
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
    );

    expect(screen.getByText('Milestone One')).toBeInTheDocument();
    expect(screen.getByText('Grouped task')).toBeInTheDocument();
  });
});
