/**
 * An event already in progress must still say what it is.
 *
 * @remarks
 * The canvas opens scrolled to roughly one hour before now, so the meeting most likely to matter —
 * the one happening right this minute — routinely starts above the fold. Its title and time row used
 * to be laid out at the item's own top edge and clipped by an `overflow-hidden` body, so it painted
 * as an unlabelled coloured rectangle. These tests pin the two structural facts that fix it: the
 * label is `sticky` (so it slides down to stay visible while the item is on screen) and nothing
 * between it and the scroll container clips it away.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';
import { assertDefined } from '@docket/test-utils';

/** A 90-minute meeting that is under way at `now`. */
const IN_PROGRESS: ScheduleItem = {
  id: 'in-progress',
  title: 'Production launch review',
  startsAt: '2026-07-01T10:00:00.000Z',
  endsAt: '2026-07-01T11:30:00.000Z',
};

const LANE: ScheduleLane = {
  id: 'date',
  label: 'Wed, Jul 1',
  date: '2026-07-01',
  items: [IN_PROGRESS],
};

afterEach(cleanup);

/** Render the canvas with the clock inside the meeting, at a readable zoom. */
function renderMidMeeting(): void {
  render(
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[LANE]}
      now="2026-07-01T11:20:00.000Z"
      pixelsPerHour={72}
      viewportWidth={600}
    />,
  );
}

describe('in-progress item labelling', () => {
  it('clamps the title and time row to the visible canvas rather than the item top', () => {
    renderMidMeeting();

    const body = document.querySelector(`[data-schedule-item-body="${IN_PROGRESS.id}"]`);
    expect(body).not.toBeNull();
    const label = body?.firstElementChild;

    expect(label).toHaveClass('sticky');
    // Offset by the canvas's own sticky header, so a clamped label lands *below* the lane
    // headings instead of underneath them.
    expect((label as HTMLElement).style.top).toBe('var(--schedule-sticky-top, 0px)');
    expect(label).toHaveTextContent('Production launch review');
    expect(label).toHaveTextContent('10:00 AM – 11:30 AM');
  });

  it('never clips the label with an intermediate scrollport', () => {
    renderMidMeeting();

    // `position: sticky` resolves against the nearest scrolling ancestor. An `overflow-hidden`
    // body counts as one, which would strand the label at the item's top edge — the original bug.
    const body = assertDefined(
      document.querySelector<HTMLElement>(`[data-schedule-item-body="${IN_PROGRESS.id}"]`),
    );
    expect(body.className).not.toContain('overflow-hidden');
    const card = body.closest('[data-schedule-item]');
    expect(card?.className).toContain('overflow-visible');
  });

  it('publishes the sticky offset from the measured header height', () => {
    renderMidMeeting();

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    // jsdom reports a zero-height header, so the value is `0px` here; what this asserts is that the
    // variable exists on the scroll container at all, which is the contract the item body reads.
    expect(viewport.style.getPropertyValue('--schedule-sticky-top')).toMatch(/^\d+px$/);
  });
});
