import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgendaDayStrip, agendaWeek } from '../../src/components/agenda/agenda-day-strip';

describe('AgendaDayStrip', () => {
  it('builds the selected Sunday-to-Saturday week without local-time date drift', () => {
    expect(agendaWeek('2026-08-20', '2026-08-18')).toEqual([
      expect.objectContaining({ iso: '2026-08-16', weekday: 'S', day: '16' }),
      expect.objectContaining({ iso: '2026-08-17', weekday: 'M', day: '17' }),
      expect.objectContaining({ iso: '2026-08-18', weekday: 'T', day: '18', today: true }),
      expect.objectContaining({ iso: '2026-08-19', weekday: 'W', day: '19' }),
      expect.objectContaining({ iso: '2026-08-20', weekday: 'T', day: '20', selected: true }),
      expect.objectContaining({ iso: '2026-08-21', weekday: 'F', day: '21' }),
      expect.objectContaining({ iso: '2026-08-22', weekday: 'S', day: '22' }),
    ]);
  });

  it('renders seven touch-sized dates and selects a visible day immediately', () => {
    const onSelect = vi.fn();
    render(
      <AgendaDayStrip
        date="2026-08-20"
        today="2026-08-18"
        onSelect={onSelect}
        onPageWeek={vi.fn()}
      />,
    );

    const strip = screen.getByRole('list', { name: 'Choose a day' });
    const dates = within(strip).getAllByRole('button');
    expect(dates).toHaveLength(7);
    for (const date of dates) expect(date).toHaveClass('min-h-10', 'min-w-10');
    expect(within(strip).getByRole('button', { name: 'Thursday, August 20' })).toHaveAttribute(
      'aria-current',
      'date',
    );
    expect(within(strip).getByRole('button', { name: 'Tuesday, August 18' })).toHaveAttribute(
      'data-agenda-today',
    );

    fireEvent.click(within(strip).getByRole('button', { name: 'Friday, August 21' }));
    expect(onSelect).toHaveBeenCalledWith('2026-08-21');
  });

  it('pages one week after a deliberate horizontal swipe and ignores a vertical drag', () => {
    const onPageWeek = vi.fn();
    render(
      <AgendaDayStrip
        date="2026-08-20"
        today="2026-08-18"
        onSelect={vi.fn()}
        onPageWeek={onPageWeek}
      />,
    );

    const strip = screen.getByRole('list', { name: 'Choose a day' });
    fireEvent.pointerDown(strip, { pointerId: 1, clientX: 240, clientY: 40 });
    fireEvent.pointerUp(strip, { pointerId: 1, clientX: 170, clientY: 44 });
    expect(onPageWeek).toHaveBeenCalledWith('next');

    fireEvent.pointerDown(strip, { pointerId: 2, clientX: 180, clientY: 40 });
    fireEvent.pointerUp(strip, { pointerId: 2, clientX: 176, clientY: 110 });
    expect(onPageWeek).toHaveBeenCalledTimes(1);
  });
});
