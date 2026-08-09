/**
 * Behavior tests for {@link import('../../src/components/scheduling-plan/day-start-review')}.
 *
 * @remarks
 * The morning walk-through is the one surface where a click costs the day something: `defer` moves
 * a real calendar block to another date. So the properties pinned here are the ones whose
 * regression would either move the wrong block or move a block nobody may move:
 *
 * - each answer reaches `onDecide` with that proposal's own key and the right decision;
 * - a proposal Docket did not place (`deferable: false`) offers "Keep" and no "Move out" at all,
 *   because an enabled button that 422s is worse than an absent one;
 * - every row locks while a decision is in flight, so a double-click cannot answer twice;
 * - a walked-through day (`acknowledgedAt` set) is readable but no longer answerable.
 */
import '@testing-library/jest-dom/vitest';

import type { DayStartOut, MorningProposalOut } from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DayStartReview } from '../../src/components/scheduling-plan/day-start-review';

/** One proposed block. Defaults are the ordinary case: scheduler-placed, still unanswered. */
function proposal(overrides: Partial<MorningProposalOut> & { key: string }): MorningProposalOut {
  return {
    calendarItemId: overrides.key,
    taskId: null,
    organizationId: null,
    title: 'Write the donor letter',
    shape: 'deep_writing',
    startsAt: '2026-08-09T16:00:00.000Z',
    endsAt: '2026-08-09T17:00:00.000Z',
    decision: 'proposed',
    deferredTo: null,
    deferable: true,
    ...overrides,
  };
}

/** A ready day-start payload built around the given proposals. */
function dayStart(
  proposals: readonly MorningProposalOut[],
  overrides: Partial<DayStartOut> = {},
): DayStartOut {
  const outstanding = proposals.filter((p) => p.decision === 'proposed').length;
  return {
    date: '2026-08-09',
    timezone: 'America/Los_Angeles',
    readiness: 'ready',
    ready: true,
    agenda: [],
    proposals: [...proposals],
    confirm: { available: outstanding === 0, outstanding, confirmedAt: null },
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

/** The row for one proposal, addressed by its position in the agenda list. */
function row(index: number): HTMLElement {
  const rows = screen.getAllByTestId('morning-agenda-item');
  const found = rows[index];
  if (!found) throw new Error(`No agenda row at index ${String(index)}`);
  return found;
}

afterEach(cleanup);

describe('DayStartReview', () => {
  it('answers the row that was clicked, with that row’s own key', () => {
    const onDecide = vi.fn();
    render(
      <DayStartReview
        dayStart={dayStart([
          proposal({ key: 'block-a', title: 'Write the donor letter' }),
          proposal({ key: 'block-b', title: 'Review the shot list' }),
        ])}
        directive={undefined}
        onAcknowledge={vi.fn()}
        acknowledging={false}
        onDecide={onDecide}
      />,
    );

    fireEvent.click(within(row(0)).getByRole('button', { name: 'Keep' }));
    expect(onDecide).toHaveBeenCalledWith({ key: 'block-a', decision: 'keep' });

    // The second row must not answer for the first: the key is what decides which calendar block
    // moves, so a shared or stale key would defer the wrong block out of today.
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Move out' }));
    expect(onDecide).toHaveBeenLastCalledWith({ key: 'block-b', decision: 'defer' });
    expect(onDecide).toHaveBeenCalledTimes(2);
  });

  it('offers no "Move out" for a block Docket did not place', () => {
    render(
      <DayStartReview
        dayStart={dayStart([proposal({ key: 'block-a', deferable: false })])}
        directive={undefined}
        onAcknowledge={vi.fn()}
        acknowledging={false}
        onDecide={vi.fn()}
      />,
    );

    const answers = within(row(0))
      .getAllByRole('button', { name: /^(Keep|Move out)$/ })
      .map((button) => button.textContent);
    expect(answers).toEqual(['Keep']);
    expect(within(row(0)).queryByRole('button', { name: 'Move out' })).not.toBeInTheDocument();
  });

  it('locks every row while a decision is in flight', () => {
    const onDecide = vi.fn();
    render(
      <DayStartReview
        dayStart={dayStart([proposal({ key: 'block-a' }), proposal({ key: 'block-b' })])}
        directive={undefined}
        onAcknowledge={vi.fn()}
        acknowledging={false}
        onDecide={onDecide}
        deciding
      />,
    );

    for (const button of screen.getAllByRole('button', { name: /Keep|Move out/ })) {
      expect(button).toBeDisabled();
    }
    // A second answer landing on top of an unsettled first is how one of them gets lost.
    fireEvent.click(within(row(0)).getByRole('button', { name: 'Keep' }));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('leaves a walked-through day readable but no longer answerable', () => {
    const onDecide = vi.fn();
    render(
      <DayStartReview
        dayStart={dayStart([proposal({ key: 'block-a', decision: 'kept' })], {
          acknowledgedAt: '2026-08-09T15:30:00.000Z',
        })}
        directive={undefined}
        onAcknowledge={vi.fn()}
        acknowledging={false}
        onDecide={onDecide}
      />,
    );

    expect(within(row(0)).getByText('Write the donor letter')).toBeInTheDocument();
    expect(within(row(0)).getByRole('button', { name: 'Keep' })).toBeDisabled();
    fireEvent.click(within(row(0)).getByRole('button', { name: 'Keep' }));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('marks the answer already given, so a reload shows the decision rather than a blank row', () => {
    render(
      <DayStartReview
        dayStart={dayStart([
          proposal({ key: 'block-a', decision: 'deferred', deferredTo: '2026-08-10' }),
        ])}
        directive={undefined}
        onAcknowledge={vi.fn()}
        acknowledging={false}
        onDecide={vi.fn()}
      />,
    );

    expect(within(row(0)).getByRole('button', { name: 'Move out' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(row(0)).getByRole('button', { name: 'Keep' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('states a day nobody planned instead of showing an empty agenda', () => {
    render(
      <DayStartReview
        dayStart={dayStart([], { ready: false, readiness: 'not_generated' })}
        directive={undefined}
        onAcknowledge={vi.fn()}
        acknowledging={false}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Today is not planned yet' })).toBeInTheDocument();
    expect(screen.queryByTestId('morning-agenda')).not.toBeInTheDocument();
  });
});
