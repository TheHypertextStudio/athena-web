/** Degraded immersive Focus states retain authoritative timer navigation. */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { timerState, taskState } = vi.hoisted(() => ({
  timerState: {
    record: {
      id: 'record_1',
      organizationId: 'org_1',
      taskId: 'task_1',
      title: 'Ship Focus mode',
      contexts: [],
    },
    phase: 'running',
    title: 'Ship Focus mode',
    unanchored: false,
    elapsedMs: 60_000,
    suggestion: null,
    nudging: false,
    loading: false,
    error: null,
  },
  taskState: {
    task: null,
    workflowState: null,
    workflowStates: [],
    isPending: true,
    error: null,
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/time-tracking/use-timer', () => ({
  useTimerState: () => timerState,
  useTimerControls: () => ({
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    rename: vi.fn(),
    starting: false,
    transitioning: false,
    renaming: false,
  }),
}));
vi.mock('@/components/time-tracking/use-focus-task', () => ({
  useFocusTask: () => taskState,
}));
vi.mock('@/components/time-tracking/use-focus-today', () => ({
  useFocusToday: () => ({ records: [], isPending: false, error: null }),
}));
const { default: FocusImmersive } = await import('@/components/time-tracking/focus-immersive');

afterEach(cleanup);

describe('FocusImmersive', () => {
  it('uses the shared focus route frame instead of a route-specific page shell', () => {
    render(
      <TooltipProvider>
        <FocusImmersive />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('focus-route-frame')).toHaveAttribute('data-density');
    expect(screen.getByTestId('focus-route-frame')).toHaveAttribute('data-surface-tone', 'canvas');
  });

  it('keeps an anchored task linked while its additional context is loading', () => {
    render(
      <TooltipProvider>
        <FocusImmersive />
      </TooltipProvider>,
    );

    expect(
      screen
        .getAllByRole('link', { name: /Ship Focus mode/ })
        .every((link) => link.getAttribute('href') === '/orgs/org_1/tasks/task_1'),
    ).toBe(true);
    expect(screen.getByTestId('focus-task-loading')).toBeInTheDocument();
    expect(screen.queryByText(/Name this session/)).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Hand something to Athena' })).toBeNull();
  });
});
