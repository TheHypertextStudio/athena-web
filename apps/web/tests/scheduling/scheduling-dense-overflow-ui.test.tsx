import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SchedulingDenseOverflow } from '@/components/scheduling/scheduling-dense-overflow-ui';
import { arrangeDenseScheduleItems } from '@/components/scheduling/scheduling-dense-overflow';
import { positionScheduleLaneItems } from '@/components/scheduling/scheduling-overlap-layout';
import type { ScheduleItem, ScheduleLane } from '@/components/scheduling/scheduling-types';

const lane: ScheduleLane = {
  id: 'date:2026-07-13',
  label: 'Mon, Jul 13',
  date: '2026-07-13',
  items: Array.from(
    { length: 5 },
    (_, index): ScheduleItem => ({
      id: `dense-${String(index)}`,
      title: `Dense event ${String(index)}`,
      startsAt: '2026-07-13T09:00:00Z',
      endsAt: '2026-07-13T10:00:00Z',
      openable: true,
    }),
  ),
};

describe('SchedulingDenseOverflow', () => {
  it('exposes every width-constrained event from a keyboard-operable disclosure', async () => {
    const user = userEvent.setup();
    const positioned = positionScheduleLaneItems(lane, 'UTC', 60, 18);
    const group = arrangeDenseScheduleItems(positioned, 240).overflowGroups[0]!;
    const onOpenItem = vi.fn();
    render(
      <SchedulingDenseOverflow
        group={group}
        lane={lane}
        displayTimezone="UTC"
        onOpenItem={onOpenItem}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Show 3 more events in Mon, Jul 13' });
    trigger.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: '3 more events in Mon, Jul 13' });
    expect(within(dialog).getAllByRole('button', { name: /^Open Dense event/ })).toHaveLength(3);
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Open Dense event 4, 9:00 AM – 10:00 AM',
      }),
    );

    expect(onOpenItem).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'dense-4' }),
      lane,
    });
  });

  it('offers a touch-sized action that reveals the real interactive card', async () => {
    const user = userEvent.setup();
    const positioned = positionScheduleLaneItems(lane, 'UTC', 60, 18);
    const group = arrangeDenseScheduleItems(positioned, 240).overflowGroups[0]!;
    const onRevealItem = vi.fn();
    render(
      <SchedulingDenseOverflow
        group={group}
        lane={lane}
        displayTimezone="UTC"
        onRevealItem={onRevealItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show 3 more events in Mon, Jul 13' }));
    const reveal = screen.getByRole('button', {
      name: 'Show Dense event 4 on calendar',
    });
    expect(reveal).toHaveClass('min-h-11');
    await user.click(reveal);

    expect(onRevealItem).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'dense-4' }),
      lane,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
