import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkScheduleRunOut } from '@docket/work/work-schedule-management';
import { ScheduleHistory } from '../../src/components/work-schedules/schedule-history';
import { scheduleFixture } from './schedule-fixtures';

const actions = vi.hoisted(() => ({
  retry: vi.fn(),
  page: vi.fn(),
  hasNext: false,
  run: null as WorkScheduleRunOut | null,
}));
const { orgId, schedule, template } = scheduleFixture();
const failedRun = WorkScheduleRunOut.parse({
  id: '01K4AAAAAAAAAAAAAAAAAAAAA7',
  seriesId: schedule.id,
  scheduledFor: '2026-10-08',
  originalScheduledFor: null,
  status: 'failed',
  attempt: 1,
  failureCode: 'permission_changed',
  failedAt: '2026-10-08T10:00:00Z',
  retryAvailableAt: null,
  completedAt: null,
  canRetry: true,
  roots: [],
  templates: [{ workTypeId: template.id, workTypeVersionId: template.latestVersion?.id }],
});
vi.mock('../../src/lib/query', () => ({
  useInfiniteApiQuery: () => ({
    data: { pages: [{ items: [actions.run ?? failedRun] }] },
    isPending: false,
    isError: false,
    hasNextPage: actions.hasNext,
    isFetchingNextPage: false,
    fetchNextPage: actions.page,
  }),
  useApiQuery: () => ({ data: { name: 'Event', versionNumber: 1, archived: true } }),
}));
vi.mock('../../src/components/work-schedules/work-schedule-queries', () => ({
  workScheduleRunsDef: () => ({}),
  useWorkScheduleWrites: () => ({ retry: { isPending: false, mutateAsync: actions.retry } }),
}));
vi.mock('../../src/components/templates/work-template-identity-queries', () => ({
  workTemplateIdentityDef: () => ({}),
}));
afterEach(cleanup);
beforeEach(() => {
  actions.retry.mockReset().mockResolvedValue(failedRun);
  actions.page.mockReset();
  actions.hasNext = false;
  actions.run = null;
});

describe('schedule run recovery', () => {
  it('shows owned failure guidance and retries the exact failed occurrence', async () => {
    render(<ScheduleHistory orgId={orgId} schedule={schedule} open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.getByText(/Access changed for the schedule owner/)).toBeVisible();
    expect(screen.getByText('Event · Version 1 · Archived')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry this run' }));
    await waitFor(() => {
      expect(actions.retry).toHaveBeenCalledWith({ id: schedule.id, occurrenceId: failedRun.id });
    });
  });
  it('retains the failed run and hides provider details when retry is rejected', async () => {
    actions.retry.mockRejectedValueOnce(new Error('sensitive provider failure'));
    render(<ScheduleHistory orgId={orgId} schedule={schedule} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry this run' }));
    await screen.findByText('Work was not created');
    expect(screen.queryByText('sensitive provider failure')).not.toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry this run' })).toBeEnabled();
  });
  it('offers bounded history pagination while a reader has no retry action', () => {
    actions.hasNext = true;
    render(
      <ScheduleHistory
        orgId={orgId}
        schedule={{ ...schedule, canEdit: false }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Retry this run' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier runs' }));
    expect(actions.page).toHaveBeenCalledOnce();
  });
  it('offers an explicit Create work decision for a missed run using its saved identity', async () => {
    actions.run = {
      ...failedRun,
      status: 'needs_resolution',
      attempt: 0,
      failureCode: null,
      failedAt: null,
      templates: [],
    };
    render(<ScheduleHistory orgId={orgId} schedule={schedule} open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Needs a decision')).toBeVisible();
    expect(screen.getByText(/using its scheduled dates/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry this run' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create work' }));
    await waitFor(() => {
      expect(actions.retry).toHaveBeenCalledWith({ id: schedule.id, occurrenceId: failedRun.id });
    });
  });
});
