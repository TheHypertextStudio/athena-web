/**
 * Behavior tests for {@link import('../../src/components/today/morning-review')}.
 *
 * @remarks
 * Today is a short page on a clear day, so the property that matters most here is what the
 * walk-through does when there is nothing to walk through: it renders **nothing at all**, not a
 * heading over an empty panel, and not an alert when the read fails. Three separate conditions
 * reach that same nothing — the day has not loaded, no planning run covers today, and the day has
 * already been walked through — and each is pinned on its own, because collapsing them is exactly
 * how one of them regresses into a dead panel.
 *
 * The fourth case is the one that must not be over-suppressed: a planned, unanswered day renders,
 * and an answer given there reaches the decide mutation and tells the rest of Today to re-read.
 */
import '@testing-library/jest-dom/vitest';

import type { DayStartOut } from '@docket/planning/scheduling-directive-contract';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useDayStart, useDirective, acknowledgeMutate, decideMutate, reorganizeMutate } = vi.hoisted(
  () => ({
    useDayStart: vi.fn(),
    useDirective: vi.fn(),
    acknowledgeMutate: vi.fn(),
    decideMutate: vi.fn(),
    reorganizeMutate: vi.fn(),
  }),
);

vi.mock('@/components/scheduling-plan/use-schedule-plan', () => ({
  useDayStart,
  useDirective,
  useAcknowledgeAgenda: () => ({ mutate: acknowledgeMutate, isPending: false }),
  useDecideMorningProposal: () => ({ mutate: decideMutate, isPending: false }),
  useReorganizeDay: () => ({ mutate: reorganizeMutate, isPending: false }),
}));

import { MorningReview } from '../../src/components/today/morning-review';

/** A ready day-start payload with one unanswered proposal. */
function dayStart(overrides: Partial<DayStartOut> = {}): DayStartOut {
  return {
    date: '2026-08-09',
    timezone: 'America/Los_Angeles',
    readiness: 'ready',
    ready: true,
    agenda: [],
    proposals: [
      {
        key: 'block-a',
        calendarItemId: 'block-a',
        taskId: null,
        organizationId: null,
        title: 'Write the donor letter',
        shape: 'deep_writing',
        startsAt: '2026-08-09T16:00:00.000Z',
        endsAt: '2026-08-09T17:00:00.000Z',
        decision: 'proposed',
        deferredTo: null,
        deferable: true,
      },
    ],
    confirm: { available: false, outstanding: 1, confirmedAt: null },
    acknowledgedAt: null,
    gate: {
      kind: 'day_start',
      state: 'holding',
      outstandingSteps: ['agenda_reviewed'],
      releasedAt: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDirective.mockReturnValue({ data: undefined });
});

afterEach(cleanup);

describe('MorningReview', () => {
  it('renders nothing while the day has not loaded — and nothing when it fails to', () => {
    // Pending and error are the same `data: undefined` here on purpose: a skeleton or an alert for
    // one panel among several must not become the page.
    useDayStart.mockReturnValue({ data: undefined });
    const { container } = render(<MorningReview />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no planning run covers today', () => {
    useDayStart.mockReturnValue({
      data: dayStart({ ready: false, readiness: 'not_generated', proposals: [] }),
    });
    const { container } = render(<MorningReview />);
    // Today's own empty states cover an unplanned day; "Today is not planned yet" here would be a
    // second, contradictory empty state on the same screen.
    expect(container).toBeEmptyDOMElement();
  });

  it('stops asking once the day has been walked through', () => {
    useDayStart.mockReturnValue({
      data: dayStart({
        acknowledgedAt: '2026-08-09T15:30:00.000Z',
        confirm: { available: true, outstanding: 0, confirmedAt: '2026-08-09T15:30:00.000Z' },
      }),
    });
    const { container } = render(<MorningReview />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the walk-through on a planned day that still needs answering', () => {
    useDayStart.mockReturnValue({ data: dayStart() });
    render(<MorningReview />);

    expect(screen.getByTestId('today-morning-review')).toBeInTheDocument();
    expect(screen.getByText('Write the donor letter')).toBeInTheDocument();
  });

  it('sends an answer to the decide mutation and re-reads the rest of Today on success', () => {
    useDayStart.mockReturnValue({ data: dayStart() });
    decideMutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }): void => {
        options?.onSuccess?.();
      },
    );
    const onChanged = vi.fn();
    render(<MorningReview onChanged={onChanged} />);

    fireEvent.click(
      within(screen.getByTestId('morning-agenda-item')).getByRole('button', { name: 'Move out' }),
    );

    expect(decideMutate).toHaveBeenCalledWith(
      { key: 'block-a', decision: 'defer' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // Today's other panels read the same day; a deferral they never hear about leaves the page
    // disagreeing with itself until a reload.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
