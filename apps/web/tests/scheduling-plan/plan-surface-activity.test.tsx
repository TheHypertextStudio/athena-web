import type { DayStartOut } from '@docket/planning/scheduling-directive-contract';
import type * as AppLocationModule from '@/lib/app-location';
import type { ComponentProps } from 'react';
import { ContextProvider, PageScrollProvider } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanSurface } from '@/components/scheduling-plan/plan-surface';

const state = vi.hoisted(() => ({ dayStart: undefined as DayStartOut | undefined }));

vi.mock('@/components/docket-link', () => ({
  default: ({ navigation, ...props }: ComponentProps<'a'> & { navigation?: string }) => (
    <a {...props} data-navigation={navigation} />
  ),
}));
vi.mock('@/lib/app-location', async (importOriginal) => ({
  ...(await importOriginal<typeof AppLocationModule>()),
  useAppSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/scheduling-plan/use-schedule-plan', () => {
  const query = () => ({ data: undefined, isPending: true, isError: false });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useWeekPlan: query,
    useDayStart: () => ({
      data: state.dayStart,
      isPending: state.dayStart === undefined,
      isError: false,
    }),
    useDirective: query,
    useDayCheckIns: () => ({
      data: {
        items: [
          {
            id: 'missed',
            date: '2026-10-15',
            scheduledAt: '2026-10-15T10:00:00Z',
            firedAt: '2026-10-15T10:00:00Z',
            respondedAt: null,
            response: null,
            missed: true,
            blockCalendarItemId: null,
            blockTitle: null,
            outstandingGoals: 0,
            prompt: 'How is your day going?',
          },
        ],
      },
      isPending: false,
      isError: false,
    }),
    useDayReview: query,
    useGenerateWeek: mutation,
    useAcknowledgeAgenda: mutation,
    useDecideMorningProposal: mutation,
    useReorganizeDay: mutation,
    useRespondToCheckIn: mutation,
    useDisposeReviewItem: mutation,
    useAnswerReviewPrompt: mutation,
    useConfirmTomorrow: mutation,
  };
});
afterEach(() => {
  cleanup();
  state.dayStart = undefined;
});

it('owns a focused planning activity with an explicit return and one current lens', () => {
  render(
    <ContextProvider>
      <PageScrollProvider>
        <PlanSurface now={new Date('2026-10-15T12:00:00Z')} />
      </PageScrollProvider>
    </ContextProvider>,
  );
  expect(screen.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/today');
  expect(screen.getByRole('link', { name: 'Back to Today' })).toHaveAttribute(
    'data-navigation',
    'activity',
  );
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Plan' }));
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'The week' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Start of day' }));
  expect(screen.getByRole('button', { name: 'The week' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Start of day' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'End of day' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

it('waits for a planned day before offering check-ins, while retaining its missed history', () => {
  state.dayStart = {
    date: '2026-10-15',
    timezone: 'UTC',
    readiness: 'not_generated',
    ready: false,
    agenda: [],
    proposals: [],
    confirm: { available: false, outstanding: 0, confirmedAt: null },
    acknowledgedAt: null,
    gate: {
      kind: 'day_start',
      state: 'holding',
      outstandingSteps: ['agenda_reviewed'],
      releasedAt: null,
    },
  };
  const element = (
    <ContextProvider>
      <PageScrollProvider>
        <PlanSurface initialLens="morning" now={new Date('2026-10-15T12:00:00Z')} />
      </PageScrollProvider>
    </ContextProvider>
  );
  const view = render(element);
  expect(screen.queryByRole('heading', { name: 'Check-ins' })).not.toBeInTheDocument();
  state.dayStart = { ...state.dayStart, ready: true, readiness: 'ready' };
  view.rerender(
    <ContextProvider>
      <PageScrollProvider>
        <PlanSurface initialLens="morning" now={new Date('2026-10-15T12:00:00Z')} />
      </PageScrollProvider>
    </ContextProvider>,
  );
  expect(screen.getByRole('heading', { name: 'Check-ins' })).toBeVisible();
  expect(screen.getByText('This one came and went unanswered.')).toBeVisible();
});
