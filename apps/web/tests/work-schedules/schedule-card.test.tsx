import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleCard } from '../../src/components/work-schedules/schedule-card';
import { scheduleFixture } from './schedule-fixtures';

afterEach(cleanup);
const { schedule, template, orgId } = scheduleFixture();
function show(changes: Partial<typeof schedule> = {}) {
  const onLifecycle = vi.fn();
  render(
    <ScheduleCard
      orgId={orgId}
      schedule={{ ...schedule, ...changes }}
      template={template}
      pending={false}
      onEdit={vi.fn()}
      onHistory={vi.fn()}
      onLifecycle={onLifecycle}
      onRun={vi.fn()}
    />,
  );
  return onLifecycle;
}
describe('Program schedule overview', () => {
  it('emphasizes the next civil date and the exact cadence with a distinct edit action', () => {
    show();
    expect(screen.getByText('Oct 8, 2026')).toBeVisible();
    expect(screen.getByText('Every month on the second Thursday')).toBeVisible();
    expect(screen.getByRole('button', { name: /Edit future runs for/ })).toBeVisible();
  });
  it('uses the authoritative next title and makes failed runs discoverable', () => {
    show({ nextWorkTitle: 'A renamed dinner', failedRunCount: 2 });
    expect(screen.getByText('A renamed dinner')).toBeVisible();
    expect(screen.getByText('2 runs need attention')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review failed runs' })).toBeVisible();
  });
  it('makes a paused routine resumable and keeps history available after ending', () => {
    const onLifecycle = show({ status: 'paused' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onLifecycle).toHaveBeenCalledWith('resume');
    cleanup();
    show({ status: 'ended' });
    expect(screen.getByRole('button', { name: /Run history for/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Edit future runs for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run for a date' })).not.toBeInTheDocument();
  });
  it('explains archive continuity and suppresses writes for a reader', () => {
    show({ templateArchived: true, canEdit: false });
    expect(screen.getByText(/This schedule continues with its saved versions/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End schedule' })).not.toBeInTheDocument();
  });
});
