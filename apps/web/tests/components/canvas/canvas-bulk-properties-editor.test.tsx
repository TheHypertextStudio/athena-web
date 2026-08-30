/** `@docket/web` — mounted Task and Project bulk Properties editor contract. */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasPropertySnapshot } from '@/lib/actions';

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  commands: {
    selectedObjects: [] as {
      kind: 'task' | 'project';
      id: string;
      title: string;
      organizationId: string;
    }[],
    objectKind: 'task',
    canEdit: true,
    canTrash: true,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    pending: false,
    openSelection: vi.fn(),
    openProperties: vi.fn(),
    trashSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  },
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock('@/components/canvas/canvas-command-context', async () => {
  const { useRef, useState } = await import('react');
  return {
    useCanvasCommandContext: () => {
      const [propertiesOpen, setPropertiesOpen] = useState(false);
      const invoker = useRef<HTMLElement | null>(null);
      return {
        ...state.commands,
        execute: state.execute,
        propertiesOpen,
        openProperties: (element?: HTMLElement | null) => {
          state.commands.openProperties();
          invoker.current = element ?? null;
          setPropertiesOpen(true);
        },
        closeProperties: () => {
          setPropertiesOpen(false);
          queueMicrotask(() => invoker.current?.focus());
        },
      };
    },
  };
});
vi.mock('@/components/canvas/canvas-actions-context', () => ({
  useCanvasActions: () => null,
}));
vi.mock('@/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({
    actorOptions: [
      { value: 'actor-1', label: 'Alex Human' },
      { value: 'agent-1', label: 'Agent' },
    ],
    memberOptions: [{ value: 'actor-1', label: 'Alex Human' }],
    projectOptions: [{ value: 'project-1', label: 'Apollo' }],
    programOptions: [{ value: 'program-1', label: 'Space' }],
    initiativeOptions: [{ value: 'initiative-1', label: 'Launch' }],
    labels: [
      { id: 'label-1', name: 'Backend', color: 'blue', teamId: null },
      { id: 'label-2', name: 'Team label', color: 'red', teamId: 'team-1' },
    ],
    labelOptions: [
      { value: 'label-1', label: 'Backend' },
      { value: 'label-2', label: 'Team label' },
    ],
    teams: [{ id: 'team-1', name: 'Core' }],
    teamOptions: [{ value: 'team-1', label: 'Core' }],
    cycles: [
      {
        id: 'cycle-1',
        organizationId: 'org-1',
        teamId: 'team-1',
        number: 1,
        name: null,
        displayName: 'Cycle 1',
        startsAt: '2026-08-24T00:00:00.000Z',
        endsAt: '2026-08-30T23:59:59.999Z',
        status: 'active',
        isCurrent: true,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    ],
    milestones: [{ id: 'milestone-1', name: 'Beta', projectId: 'project-1' }],
    loading: false,
    error: null,
    failedKinds: new Set(),
    retry: vi.fn(),
  }),
}));
vi.mock('@/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({
    loaded: true,
    error: null,
    retry: vi.fn(),
    statusesFor: (kind: string) =>
      kind === 'task'
        ? [
            { key: 'todo', name: 'Todo', category: 'unstarted', description: null },
            { key: 'done', name: 'Done', category: 'completed', description: null },
          ]
        : [
            { key: 'planned', name: 'Planned', category: 'backlog', description: null },
            { key: 'active', name: 'Active', category: 'started', description: null },
          ],
  }),
}));
vi.mock('@/lib/use-estimation-scale', () => ({
  useEstimationScale: () => ({
    scale: 'fibonacci',
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock('@/lib/use-fiscal-year-start-month', () => ({
  useFiscalYearStartMonth: () => ({
    fiscalYearStartMonth: 0,
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

import BulkActionsBar from '@/components/canvas/bulk-actions-bar';

const task = (
  id: string,
  overrides: Partial<Extract<CanvasPropertySnapshot, { kind: 'task' }>> = {},
): Extract<CanvasPropertySnapshot, { kind: 'task' }> => ({
  kind: 'task',
  id,
  organizationId: 'org-1',
  state: 'todo',
  priority: 'medium',
  assigneeId: null,
  projectId: 'project-1',
  programId: null,
  milestoneId: null,
  cycleId: null,
  labelIds: [],
  teamId: 'team-1',
  startDate: null,
  dueDate: null,
  estimate: null,
  ...overrides,
});

const project = (
  id: string,
  overrides: Partial<Extract<CanvasPropertySnapshot, { kind: 'project' }>> = {},
): Extract<CanvasPropertySnapshot, { kind: 'project' }> => ({
  kind: 'project',
  id,
  organizationId: 'org-1',
  status: 'planned',
  health: null,
  priority: 'medium',
  leadId: null,
  teamId: 'team-1',
  programId: null,
  labelIds: [],
  initiativeIds: [],
  startTimeframe: null,
  targetTimeframe: null,
  ...overrides,
});

function select(snapshots: readonly CanvasPropertySnapshot[]): void {
  state.commands.objectKind = snapshots[0]?.kind ?? 'task';
  state.commands.selectedObjects = snapshots.map((snapshot) => ({
    kind: snapshot.kind,
    id: snapshot.id,
    title: snapshot.id,
    organizationId: snapshot.organizationId,
  }));
}

function openEditor(snapshots: readonly CanvasPropertySnapshot[]): void {
  select(snapshots);
  render(<BulkActionsBar propertySnapshots={snapshots} />);
  fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
}

beforeEach(() => {
  state.execute.mockReset().mockResolvedValue({ appliedIds: ['ok'] });
  state.commands.canEdit = true;
  state.commands.pending = false;
  state.commands.selectedObjects = [];
});

describe('canvas bulk Properties editor', () => {
  it('shows the complete Task catalog and Mixed on every differing scalar', () => {
    openEditor([
      task('task-a'),
      task('task-b', {
        state: 'done',
        priority: 'urgent',
        assigneeId: 'actor-1',
        projectId: null,
        programId: 'program-1',
        milestoneId: 'milestone-1',
        cycleId: 'cycle-1',
        startDate: '2026-08-01',
        dueDate: '2026-08-31',
        estimate: 5,
      }),
    ]);

    for (const label of [
      'Status',
      'Priority',
      'Assignee',
      'Project',
      'Program',
      'Milestone',
      'Cycle',
      'Labels',
      'Anticipated start date',
      'Due date',
      'Estimate',
    ]) {
      expect(screen.getByRole('group', { name: `${label} property` })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Mixed').length).toBeGreaterThanOrEqual(10);
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.queryByText('Description')).toBeNull();
  });

  it('shows the complete Project catalog and tri-state association copy', () => {
    openEditor([
      project('project-a', { labelIds: ['label-1'], initiativeIds: ['initiative-1'] }),
      project('project-b', {
        status: 'active',
        health: 'at_risk',
        priority: 'urgent',
        leadId: 'actor-1',
        teamId: null,
        programId: 'program-1',
        startTimeframe: {
          date: '2026-04-01',
          resolution: 'quarter',
          fiscalYearStartMonth: 0,
        },
        targetTimeframe: {
          date: '2026-12-31',
          resolution: 'year',
          fiscalYearStartMonth: 0,
        },
      }),
    ]);

    for (const label of [
      'Status',
      'Health',
      'Priority',
      'Lead',
      'Team',
      'Program',
      'Initiatives',
      'Labels',
      'Start timeframe',
      'Target timeframe',
    ]) {
      expect(screen.getByRole('group', { name: `${label} property` })).toBeInTheDocument();
    }
    expect(
      screen.getByText('Some selected Projects have Backend. Select to add it to all.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Some selected Projects have Launch. Select to add it to all.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Mixed')).toHaveLength(8);
  });

  it('sends one atomic scalar command and leaves the editor and selection open', async () => {
    const snapshots = [task('task-a'), task('task-b', { priority: 'urgent' })];
    openEditor(snapshots);

    fireEvent.click(screen.getByRole('button', { name: /Priority — Mixed/ }));
    fireEvent.click(
      within(await screen.findByRole('option', { name: /High/ })).getByRole('button'),
    );

    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(state.execute.mock.calls[0]?.[0]).toMatchObject({
      objectKind: 'task',
      objectIds: ['task-a', 'task-b'],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeInTheDocument();
    expect(state.commands.selectedObjects.map(({ id }) => id)).toEqual(['task-a', 'task-b']);
  });

  it('adds some or none associations to all and removes all associations from all', async () => {
    select([task('task-a', { labelIds: ['label-1'] }), task('task-b')]);
    const firstRender = render(
      <BulkActionsBar
        propertySnapshots={[task('task-a', { labelIds: ['label-1'] }), task('task-b')]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Backend — some' }));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(state.execute.mock.calls[0]?.[0].operation).toEqual({
      type: 'add_association',
      association: 'label',
      associationIds: ['label-1'],
    });

    state.execute.mockClear();
    firstRender.unmount();
    select([task('task-a', { labelIds: ['label-1'] }), task('task-b', { labelIds: ['label-1'] })]);
    render(
      <BulkActionsBar
        propertySnapshots={[
          task('task-a', { labelIds: ['label-1'] }),
          task('task-b', { labelIds: ['label-1'] }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Backend — all' }));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(state.execute.mock.calls[0]?.[0].operation).toEqual({
      type: 'remove_association',
      association: 'label',
      associationIds: ['label-1'],
    });
  });

  it('keeps an incompatible all-selected Team Label removable', async () => {
    openEditor([
      task('task-a', { teamId: 'team-1', labelIds: ['label-2'] }),
      task('task-b', { teamId: 'team-2', labelIds: ['label-2'] }),
    ]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Team label — all' }));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(state.execute.mock.calls[0]?.[0].operation).toEqual({
      type: 'remove_association',
      association: 'label',
      associationIds: ['label-2'],
    });
  });

  it('keeps an incompatible partial Team Label visible with remove-only behavior', async () => {
    openEditor([
      task('task-a', { teamId: 'team-1', labelIds: ['label-2'] }),
      task('task-b', { teamId: 'team-2' }),
    ]);

    expect(screen.getByRole('checkbox', { name: 'Team label — some' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Team label from selected' }));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(state.execute.mock.calls[0]?.[0].operation).toEqual({
      type: 'remove_association',
      association: 'label',
      associationIds: ['label-2'],
    });
  });

  it('keeps failed commands atomic and leaves the editor open', async () => {
    state.execute.mockResolvedValue(null);
    openEditor([task('task-a'), task('task-b', { priority: 'urgent' })]);
    fireEvent.click(screen.getByRole('button', { name: /Priority — Mixed/ }));
    fireEvent.click(
      within(await screen.findByRole('option', { name: /High/ })).getByRole('button'),
    );
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeInTheDocument();
    expect(state.commands.selectedObjects).toHaveLength(2);
  });

  it('keeps clear available when Milestone choices have no common Project', async () => {
    openEditor([
      task('task-a', { projectId: 'project-1', milestoneId: 'milestone-1' }),
      task('task-b', { projectId: null, milestoneId: null }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Milestone — not set/ }));
    fireEvent.click(await screen.findByText('No milestone'));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledOnce();
    });
    expect(state.execute.mock.calls[0]?.[0]).toMatchObject({
      objectIds: ['task-a', 'task-b'],
      operation: { type: 'replace_property', property: 'milestoneId', value: null },
    });
  });

  it('clears all four mixed nullable date and timeframe fields with explicit commands', async () => {
    openEditor([
      task('task-a'),
      task('task-b', { startDate: '2026-08-01', dueDate: '2026-08-31' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Clear anticipated start date for all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear due date for all' }));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledTimes(2);
    });
    expect(state.execute.mock.calls.slice(0, 2).map(([command]) => command.operation)).toEqual([
      { type: 'replace_property', property: 'startDate', value: null },
      { type: 'replace_property', property: 'dueDate', value: null },
    ]);

    cleanup();
    state.execute.mockClear();
    openEditor([
      project('project-a'),
      project('project-b', {
        startTimeframe: {
          date: '2026-04-01',
          resolution: 'quarter',
          fiscalYearStartMonth: 0,
        },
        targetTimeframe: {
          date: '2026-12-31',
          resolution: 'year',
          fiscalYearStartMonth: 0,
        },
      }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Clear start timeframe for all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear target timeframe for all' }));
    await waitFor(() => {
      expect(state.execute).toHaveBeenCalledTimes(2);
    });
    expect(state.execute.mock.calls.map(([command]) => command.operation)).toEqual([
      {
        type: 'replace_property',
        property: 'startTimeframe',
        value: { date: null, resolution: null },
      },
      {
        type: 'replace_property',
        property: 'targetTimeframe',
        value: { date: null, resolution: null },
      },
    ]);
  });

  it('disables mutation controls for read-only, pending, and over-500 selections', () => {
    select([task('task-a')]);
    state.commands.canEdit = false;
    const { unmount } = render(<BulkActionsBar propertySnapshots={[task('task-a')]} />);
    expect(screen.getByRole('button', { name: 'Properties' })).toBeDisabled();
    unmount();

    state.commands.canEdit = true;
    state.commands.pending = true;
    openEditor([task('task-a')]);
    expect(screen.getByRole('button', { name: /Priority/ })).toBeDisabled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('explains the 500-object limit and never emits a command', () => {
    const snapshots = Array.from({ length: 501 }, (_, index) => task(`task-${String(index)}`));
    openEditor(snapshots);
    expect(
      screen.getByText('Properties supports at most 500 selected objects.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Priority/ })).toBeDisabled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('uses selected-object count for the 500-object limit when a snapshot is stale', () => {
    const selection = Array.from({ length: 501 }, (_, index) => task(`task-${String(index)}`));
    select(selection);
    render(<BulkActionsBar propertySnapshots={selection.slice(0, 500)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));

    expect(
      screen.getByText('Properties supports at most 500 selected objects.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Priority/ })).toBeDisabled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('uses a bounded responsive editor with a scrolling body and a non-wrapping action bar', () => {
    openEditor([task('task-a')]);
    expect(screen.getByTestId('canvas-selection-bar')).toHaveClass('flex-nowrap');
    expect(screen.getByTestId('canvas-properties-editor')).toHaveClass(
      'w-[calc(100%-1.5rem)]',
      'max-w-sm',
    );
    expect(screen.getByTestId('canvas-properties-body')).toHaveClass('overflow-y-auto');
    expect(screen.getByRole('heading', { name: 'Properties' })).toHaveAttribute('id');
  });

  it('moves focus into Properties and returns it to the trigger on close', async () => {
    select([task('task-a')]);
    render(<BulkActionsBar propertySnapshots={[task('task-a')]} />);
    const trigger = screen.getByRole('button', { name: 'Properties' });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Properties' })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
