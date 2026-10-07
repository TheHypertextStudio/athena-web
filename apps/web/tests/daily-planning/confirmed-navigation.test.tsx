import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmedStage } from '../../src/components/daily-planning/daily-planning-confirmed';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';

vi.mock('../../src/components/daily-planning/daily-planning-agenda', () => ({
  clock: (instant: string) => instant.slice(11, 16),
}));
vi.mock('../../src/components/docket-link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));

const originalLocation = window.location;
const assign = vi.fn();

function controller(): ReadyPlanningController {
  return {
    date: '2026-10-06',
    timezone: 'UTC',
    confirming: false,
    deferPending: false,
    isMovingTask: () => false,
    isCurrentDate: () => true,
    fixed: [],
    draft: { date: '2026-10-06', tasks: [], sessions: [] },
    allTasks: new Map(),
    timer: { phase: 'idle', record: null },
    dayQ: { data: { actual: [] } },
    titleFor: (id: string) => id,
  } as unknown as ReadyPlanningController;
}

beforeEach(() => {
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign },
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('confirmed daily plan navigation', () => {
  it('loads Today as a new document so the planner cannot retain its route content', () => {
    render(<ConfirmedStage plan={controller()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).toHaveBeenCalledExactlyOnceWith('/today');
  });

  it.each(['confirming', 'deferPending'] as const)('disables leaving while %s', (pending) => {
    render(<ConfirmedStage plan={{ ...controller(), [pending]: true }} />);
    const button = screen.getByRole('button', { name: 'Go to Today' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(assign).not.toHaveBeenCalled();
  });

  it('guards a pending move before its state update renders', () => {
    render(<ConfirmedStage plan={{ ...controller(), isMovingTask: () => true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores a retained button from an old planning date', () => {
    render(<ConfirmedStage plan={{ ...controller(), isCurrentDate: () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).not.toHaveBeenCalled();
  });
});
