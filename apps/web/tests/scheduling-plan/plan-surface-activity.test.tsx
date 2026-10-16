import type * as AppLocationModule from '@/lib/app-location';
import type { ComponentProps } from 'react';
import { ContextProvider, PageScrollProvider } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanSurface } from '@/components/scheduling-plan/plan-surface';

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
    useDayStart: query,
    useDirective: query,
    useDayCheckIns: query,
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
afterEach(cleanup);

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
