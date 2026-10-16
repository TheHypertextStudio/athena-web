import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { RecurrenceWeekday } from '@docket/work/recurrence';
import { RepeatWeekdaySelection } from '@/components/recurrence/repeat-weekday-selection';

function WeeklySelection() {
  const [days, setDays] = useState<RecurrenceWeekday[]>(['monday']);
  return <RepeatWeekdaySelection value={days} onChange={setDays} />;
}

describe('weekly repeat days', () => {
  it('distinguishes similar weekdays visibly and retains the last selected day', () => {
    render(<WeeklySelection />);
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveTextContent('Tue');
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveTextContent('Thu');
    expect(screen.getByRole('button', { name: 'Saturday' })).toHaveTextContent('Sat');
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveTextContent('Sun');
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows revising the weekday without clearing the schedule', () => {
    render(<WeeklySelection />);
    fireEvent.click(screen.getByRole('button', { name: 'Thursday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
