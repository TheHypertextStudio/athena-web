import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleRunDialog } from '../../src/components/work-schedules/schedule-run-dialog';
import { scheduleFixture } from './schedule-fixtures';

const actions = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../src/components/work-schedules/work-schedule-queries', () => ({
  useWorkScheduleWrites: () => ({ run: { isPending: false, mutateAsync: actions.run } }),
}));
afterEach(cleanup);
beforeEach(() => {
  actions.run.mockReset();
});
const { orgId, schedule } = scheduleFixture();

describe('explicit schedule runs', () => {
  it('uses the date identity for calendar runs so a rejected request cannot create a second occurrence', async () => {
    actions.run.mockRejectedValue(new Error('unavailable'));
    render(<ScheduleRunDialog orgId={orgId} schedule={schedule} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create this run' }));
    await screen.findByText('Run was not created');
    fireEvent.click(screen.getByRole('button', { name: 'Create this run' }));
    await waitFor(() => {
      expect(actions.run).toHaveBeenCalledTimes(2);
    });
    expect(actions.run.mock.calls[0]?.[0]).toEqual(actions.run.mock.calls[1]?.[0]);
    expect(actions.run.mock.calls[0]?.[0]).not.toHaveProperty('occurrenceKey');
  });
  it('keeps one stable explicit key across manual-run retries', async () => {
    actions.run.mockRejectedValue(new Error('unavailable'));
    render(
      <ScheduleRunDialog
        orgId={orgId}
        schedule={{ ...schedule, revision: { ...schedule.revision, trigger: { kind: 'manual' } } }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create this run' }));
    await screen.findByText('Run was not created');
    fireEvent.click(screen.getByRole('button', { name: 'Create this run' }));
    await waitFor(() => {
      expect(actions.run).toHaveBeenCalledTimes(2);
    });
    expect(actions.run.mock.calls[0]?.[0]).toEqual(actions.run.mock.calls[1]?.[0]);
    expect(actions.run.mock.calls[0]?.[0].occurrenceKey).toMatch(/^manual:/);
  });
});
