import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasPropertySnapshot } from '@/lib/actions';

const sources = vi.hoisted(() => ({
  retryOptions: vi.fn(),
  retryStatuses: vi.fn(),
  retryEstimation: vi.fn(),
  retryPlanning: vi.fn(),
}));

vi.mock('@/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => ({
    selectedObjects: [{ kind: 'task', id: 'task-1', title: 'Task', organizationId: 'org-1' }],
    objectKind: 'task',
    canEdit: true,
    pending: false,
    execute: vi.fn(),
  }),
}));
vi.mock('@/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({
    actorOptions: [],
    memberOptions: [],
    projectOptions: [],
    projects: [],
    programOptions: [],
    initiativeOptions: [],
    labelOptions: [],
    labels: [],
    teamOptions: [],
    teams: [],
    cycles: [],
    milestones: [],
    loading: false,
    error: 'Could not load some property choices.',
    failedKinds: new Set(['actors']),
    retry: sources.retryOptions,
  }),
}));
vi.mock('@/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({
    loaded: false,
    error: 'Could not load statuses.',
    retry: sources.retryStatuses,
    statusesFor: () => [],
  }),
}));
vi.mock('@/lib/use-estimation-scale', () => ({
  useEstimationScale: () => ({
    scale: null,
    loading: false,
    error: 'Could not load estimation settings.',
    retry: sources.retryEstimation,
  }),
}));
vi.mock('@/lib/use-fiscal-year-start-month', () => ({
  useFiscalYearStartMonth: () => ({
    fiscalYearStartMonth: 0,
    loading: false,
    error: 'Could not load planning calendar settings.',
    retry: sources.retryPlanning,
  }),
}));

import CanvasPropertiesEditor from '@/components/canvas/canvas-properties-editor';

const task: Extract<CanvasPropertySnapshot, { kind: 'task' }> = {
  kind: 'task',
  id: 'task-1',
  organizationId: 'org-1',
  state: 'backlog',
  priority: 'none',
  assigneeId: null,
  projectId: null,
  programId: null,
  milestoneId: null,
  cycleId: null,
  labelIds: [],
  teamId: 'team-1',
  startDate: null,
  dueDate: null,
  estimate: null,
};

beforeEach(() => {
  sources.retryOptions.mockClear();
  sources.retryStatuses.mockClear();
  sources.retryEstimation.mockClear();
  sources.retryPlanning.mockClear();
});

describe('canvas Properties source failures', () => {
  it('shows owned errors with retry actions without disabling unrelated scalars', () => {
    render(<CanvasPropertiesEditor snapshots={[task]} />);

    expect(screen.getByText('Could not load some property choices.')).toBeInTheDocument();
    expect(screen.getByText('Could not load statuses.')).toBeInTheDocument();
    expect(screen.getByText('Could not load estimation settings.')).toBeInTheDocument();
    expect(screen.queryByText('Estimation is disabled for this workspace.')).toBeNull();
    expect(screen.getByRole('button', { name: /Priority/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Assignee/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry property choices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry statuses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry estimation settings' }));
    expect(sources.retryOptions).toHaveBeenCalledOnce();
    expect(sources.retryStatuses).toHaveBeenCalledOnce();
    expect(sources.retryEstimation).toHaveBeenCalledOnce();
  });
});
