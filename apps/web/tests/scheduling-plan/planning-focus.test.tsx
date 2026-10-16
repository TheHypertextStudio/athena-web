import '@testing-library/jest-dom/vitest';
import type { DayCheckInOut, DayReviewOut } from '@docket/planning/scheduling-directive-contract';
import type { WeekPlanOut } from '@docket/planning/scheduling-contract';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DayCheckIns } from '@/components/scheduling-plan/day-check-ins';
import { EveningReview } from '@/components/scheduling-plan/evening-review';
import { WeekPlanBoard } from '@/components/scheduling-plan/week-plan-board';

const week: WeekPlanOut = {
  runId: null,
  weekStartDate: '2026-10-12',
  weekEndDate: '2026-10-18',
  timezone: 'UTC',
  generatedAt: '2026-10-16T12:00:00Z',
  dryRun: false,
  blocks: [],
  unplaced: [],
  shapesPresent: [],
  userInputCount: 0,
  coverage: {
    availableMinutes: 480,
    scheduledMinutes: 0,
    coveragePercent: 0,
    protectedMinutes: 0,
    largestGapMinutes: 480,
    gaps: [],
    withinThreshold: false,
  },
};
const review: DayReviewOut = {
  date: '2026-10-16',
  timezone: 'UTC',
  tomorrowDate: '2026-10-17',
  items: [],
  steps: [
    { key: 'reconcile', title: 'Decide on unfinished work', complete: true, outstanding: 0 },
    { key: 'reflect', title: 'Review the day', complete: false, outstanding: 1 },
    {
      key: 'prepare_tomorrow',
      title: "Confirm tomorrow's agenda",
      complete: false,
      outstanding: 1,
    },
  ],
  answers: [
    { key: 'what_moved', prompt: 'What actually moved today?', answer: null, required: true },
  ],
  tomorrowProposals: [
    {
      key: 'tomorrow-a',
      title: 'Welcome the volunteers',
      shape: null,
      startsAt: '2026-10-17T10:00:00Z',
      endsAt: '2026-10-17T11:00:00Z',
      organizationId: null,
      carriedFromKey: null,
    },
  ],
  tomorrowConfirmedAt: null,
  complete: false,
  completedAt: null,
  gate: {
    kind: 'day_end',
    state: 'holding',
    outstandingSteps: ['day_reflected', 'tomorrow_confirmed'],
    releasedAt: null,
  },
};
const checkIn: DayCheckInOut = {
  id: 'future',
  date: '2026-10-16',
  scheduledAt: '2026-10-16T16:00:00Z',
  firedAt: null,
  respondedAt: null,
  response: null,
  missed: false,
  blockCalendarItemId: null,
  blockTitle: null,
  outstandingGoals: 1,
  prompt: 'How is the invitation going?',
};
afterEach(cleanup);

it('offers planning an empty week without premature coverage warnings or seven empty cards', () => {
  const generate = vi.fn();
  render(<WeekPlanBoard plan={week} onGenerate={generate} />);
  expect(screen.queryByText('Over your limit')).not.toBeInTheDocument();
  expect(screen.queryByTestId('week-plan-grid')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Plan this week' }));
  expect(generate).toHaveBeenCalledOnce();
});

it('keeps due and missed check-ins actionable and future check-ins behind a disclosure', () => {
  const respond = vi.fn();
  render(
    <DayCheckIns
      checkIns={[
        checkIn,
        {
          ...checkIn,
          id: 'due',
          firedAt: '2026-10-16T16:00:00Z',
          prompt: 'How is the booking going?',
        },
      ]}
      timezone="UTC"
      onRespond={respond}
    />,
  );
  expect(screen.queryByText(checkIn.prompt)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'On track' }));
  expect(respond).toHaveBeenCalledWith({ id: 'due', response: 'on_track' });
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming check-ins (1)' }));
  expect(screen.getByText(checkIn.prompt)).toBeVisible();
});

it('focuses one evening step, retains answers on revisiting, and gates final confirmation', () => {
  const answer = vi.fn();
  const confirm = vi.fn();
  const view = render(
    <EveningReview
      review={review}
      onDispose={vi.fn()}
      onAnswer={answer}
      onConfirmTomorrow={confirm}
    />,
  );
  expect(screen.queryByTestId('tomorrow-proposals')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The invitation is ready.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(answer).toHaveBeenCalledWith({ key: 'what_moved', answer: 'The invitation is ready.' });
  fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
  expect(screen.queryByTestId('review-questions')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Confirm tomorrow's agenda" })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Keeping' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reflect' }));
  expect(screen.getByRole('textbox')).toHaveValue('The invitation is ready.');
  view.rerender(
    <EveningReview
      review={{
        ...review,
        steps: review.steps.map((step) =>
          step.key === 'reflect' ? { ...step, complete: true, outstanding: 0 } : step,
        ),
      }}
      onDispose={vi.fn()}
      onAnswer={answer}
      onConfirmTomorrow={confirm}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
  expect(
    screen.queryByText(
      'Finish your work decisions and save your reflections before confirming tomorrow.',
    ),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "Confirm tomorrow's agenda" }));
  expect(confirm).toHaveBeenCalledWith([]);
});

it('retains a drop explanation while revisiting another evening step and saves the right commitment', () => {
  const dispose = vi.fn();
  const unfinished: DayReviewOut = {
    ...review,
    steps: review.steps.map((step) =>
      step.key === 'reconcile' ? { ...step, complete: false, outstanding: 1 } : step,
    ),
    items: [
      {
        key: 'invitation',
        calendarItemId: null,
        taskId: null,
        organizationId: null,
        title: 'Send the invitation',
        shape: null,
        startsAt: null,
        endsAt: null,
        disposition: null,
        rescheduledTo: null,
        reason: null,
      },
    ],
  };
  const view = render(
    <EveningReview
      review={unfinished}
      onDispose={dispose}
      onAnswer={vi.fn()}
      onConfirmTomorrow={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Drop' })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('Why is this not happening?'), {
    target: { value: 'The gathering moved to next month.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reflect' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unfinished work' }));
  expect(screen.getByPlaceholderText('Why is this not happening?')).toHaveValue(
    'The gathering moved to next month.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
  expect(dispose).toHaveBeenCalledWith({
    key: 'invitation',
    disposition: 'dropped',
    reason: 'The gathering moved to next month.',
  });
  view.rerender(
    <EveningReview
      review={unfinished}
      onDispose={dispose}
      onAnswer={vi.fn()}
      onConfirmTomorrow={vi.fn()}
      busy
    />,
  );
  expect(screen.getByRole('button', { name: 'Actually done' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move to tomorrow' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Drop' })).toBeDisabled();
});

it('keeps missed and answered check-ins visible while future checks stay secondary', () => {
  render(
    <DayCheckIns
      timezone="UTC"
      onRespond={vi.fn()}
      checkIns={[
        checkIn,
        {
          ...checkIn,
          id: 'missed',
          firedAt: '2026-10-16T16:00:00Z',
          missed: true,
          prompt: 'Did the invitation go out?',
        },
        {
          ...checkIn,
          id: 'answered',
          firedAt: '2026-10-16T16:00:00Z',
          respondedAt: '2026-10-16T16:01:00Z',
          response: 'behind',
          prompt: 'How did the booking go?',
        },
      ]}
    />,
  );
  expect(screen.getByText('This one came and went unanswered.')).toBeVisible();
  expect(screen.getByText('You said: Behind')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Behind' })).toBeEnabled();
  expect(screen.queryByText(checkIn.prompt)).not.toBeInTheDocument();
});
