import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OutsideWorkHours } from '../../src/components/daily-planning/daily-planning-outside-hours';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';

afterEach(cleanup);

function plan(): ReadyPlanningController {
  return {
    preview: null,
    draft: {
      finishAt: '2026-10-07T14:00:00.000Z',
      sessions: [
        {
          id: 'retained',
          startsAt: '2026-10-07T13:30:00.000Z',
          endsAt: '2026-10-07T14:30:00.000Z',
          pinned: true,
          allocations: [
            { taskId: 'first', plannedMinutes: 30 },
            { taskId: 'late', plannedMinutes: 30 },
          ],
        },
      ],
    },
    allTasks: new Map(),
    titleFor: (id: string) => (id === 'late' ? 'Send the launch assets' : 'Finish the checklist'),
    setEditing: vi.fn(),
  } as unknown as ReadyPlanningController;
}

it('names only work after the chosen finish and opens its retained block', () => {
  const controller = plan();
  render(<OutsideWorkHours plan={controller} />);
  expect(screen.getByText('Send the launch assets')).toBeVisible();
  expect(screen.queryByText('Finish the checklist')).not.toBeInTheDocument();
  expect(screen.getByText('30 minutes scheduled after Finish.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Move or shorten block' }));
  expect(controller.setEditing).toHaveBeenCalledWith({ taskId: 'late', sessionId: 'retained' });
});

it('uses the preview finish without changing the retained draft', () => {
  const controller = plan();
  controller.preview = {
    title: 'Proposed schedule',
    draft: { ...controller.draft, finishAt: '2026-10-07T14:30:00.000Z' },
  };
  render(<OutsideWorkHours plan={controller} />);
  expect(screen.queryByText('After finish time')).not.toBeInTheDocument();
  expect(controller.draft.finishAt).toBe('2026-10-07T14:00:00.000Z');
});

it('keeps preview-only retained work visible without allowing an edit before Apply', () => {
  const controller = plan();
  controller.preview = { title: 'Proposed schedule', draft: controller.draft };
  render(<OutsideWorkHours plan={controller} />);
  expect(screen.getByRole('button', { name: 'Move or shorten block' })).toBeDisabled();
});
