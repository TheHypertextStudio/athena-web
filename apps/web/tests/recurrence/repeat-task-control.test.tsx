/** Product-native repeat property behavior for the ordinary task composer. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultTaskRepeat,
  RepeatTaskControl,
  taskRepeatSummary,
} from '../../src/components/recurrence/repeat-task-control';

afterEach(cleanup);

describe('RepeatTaskControl', () => {
  it('authors the second Thursday of each month and describes the exact weekday', () => {
    const onChange = vi.fn();
    const initial = createDefaultTaskRepeat('monthly', '2026-10-15', 'America/Los_Angeles');
    const { rerender } = render(
      <RepeatTaskControl
        presentation="inline"
        value={initial}
        onChange={onChange}
        today="2026-10-15"
        timezone="America/Los_Angeles"
      />,
    );
    fireEvent.change(screen.getByLabelText('Monthly repeat pattern'), {
      target: { value: 'nth_weekday' },
    });
    const changed = onChange.mock.calls.at(-1)?.[0];
    expect(changed).toMatchObject({
      kind: 'calendar',
      schedule: {
        kind: 'monthly',
        pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
      },
    });
    expect(taskRepeatSummary(changed)).toBe('Every month on the second Thursday');
    rerender(
      <RepeatTaskControl
        presentation="inline"
        value={changed}
        onChange={onChange}
        today="2026-10-15"
        timezone="America/Los_Angeles"
      />,
    );
    fireEvent.change(screen.getByLabelText('Monthly weekday position'), {
      target: { value: '-1' },
    });
    expect(onChange.mock.calls.at(-1)?.[0].schedule.pattern).toEqual({
      kind: 'nth_weekday',
      ordinal: -1,
      weekday: 'thursday',
    });
  });

  it('lets a yearly schedule keep a leap-day rule with explicit overflow behavior', () => {
    const onChange = vi.fn();
    render(
      <RepeatTaskControl
        presentation="inline"
        value={createDefaultTaskRepeat('yearly', '2028-02-29', 'UTC')}
        onChange={onChange}
        today="2028-02-29"
        timezone="UTC"
      />,
    );
    expect(screen.getByLabelText('Repeat month')).toHaveValue('2');
    expect(screen.getByLabelText('Repeat day')).toHaveValue(29);
    fireEvent.change(screen.getByLabelText('Short month behavior'), { target: { value: 'skip' } });
    expect(onChange.mock.calls.at(-1)?.[0].schedule).toMatchObject({
      month: 2,
      day: 29,
      overflow: 'skip',
    });
  });
  it.each(['none', 'daily', 'weekly', 'monthly', 'yearly', 'after_completion'])(
    'authors %s directly in inline setup without a second editor',
    (cadence) => {
      const onChange = vi.fn();
      render(
        <RepeatTaskControl
          presentation="inline"
          value={createDefaultTaskRepeat('monthly', '2026-08-11', 'America/Los_Angeles')}
          onChange={onChange}
          today="2026-08-11"
          timezone="America/Los_Angeles"
        />,
      );
      expect(screen.getByLabelText('Repeat cadence')).toHaveValue('monthly');
      expect(screen.getByLabelText('Repeat interval')).toHaveValue(1);
      expect(screen.getByLabelText('Repeat ends')).toHaveValue('never');
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Repeat task' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      expect(screen.getByLabelText('Schedule ahead')).toHaveValue('28');
      fireEvent.change(screen.getByLabelText('Repeat cadence'), { target: { value: cadence } });
      expect(onChange).toHaveBeenLastCalledWith(
        cadence === 'none'
          ? { kind: 'none' }
          : createDefaultTaskRepeat(
              cadence as Parameters<typeof createDefaultTaskRepeat>[0],
              '2026-08-11',
              'America/Los_Angeles',
            ),
      );
    },
  );

  it('locks every inline setting while the host saves', () => {
    render(
      <RepeatTaskControl
        presentation="inline"
        disabled
        value={createDefaultTaskRepeat('monthly', '2026-08-11', 'America/Los_Angeles')}
        onChange={vi.fn()}
        today="2026-08-11"
        timezone="America/Los_Angeles"
      />,
    );
    expect(screen.getByLabelText('Repeat cadence')).toBeDisabled();
    expect(screen.getByLabelText('Repeat interval')).toBeDisabled();
    expect(screen.getByLabelText('Repeat ends')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Repeat start date/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'More options' })).toBeDisabled();
  });

  it('uses the workspace noun when repeating other work', () => {
    render(
      <RepeatTaskControl
        value={{ kind: 'none' }}
        onChange={vi.fn()}
        today="2026-10-02"
        timezone="America/Los_Angeles"
        workNoun="Campaign"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Repeat — Does not repeat' }));
    expect(screen.getByRole('heading', { name: 'Repeat campaign' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Repeat task' })).toBeNull();
  });

  it('starts as an ordinary property and reveals a focused editor', () => {
    const onChange = vi.fn();
    render(
      <RepeatTaskControl
        value={{ kind: 'none' }}
        onChange={onChange}
        today="2026-08-11"
        timezone="America/Los_Angeles"
      />,
    );

    expect(screen.queryByLabelText('Repeat cadence')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Repeat — Does not repeat' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Repeat task' })).toBeTruthy();
    expect(screen.getByLabelText('Repeat cadence')).toBeTruthy();
  });

  it('authors a weekly discriminated schedule and keeps the summary readable', () => {
    const onChange = vi.fn();
    const initial = createDefaultTaskRepeat('weekly', '2026-08-11', 'America/Los_Angeles');
    const { rerender } = render(
      <RepeatTaskControl
        value={initial}
        onChange={onChange}
        today="2026-08-11"
        timezone="America/Los_Angeles"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Repeat — Every week on Tue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    const changed = onChange.mock.calls.at(-1)?.[0];
    expect(changed).toMatchObject({
      kind: 'calendar',
      schedule: { kind: 'weekly', weekdays: ['tuesday', 'friday'] },
    });

    rerender(
      <RepeatTaskControl
        value={changed}
        onChange={onChange}
        today="2026-08-11"
        timezone="America/Los_Angeles"
      />,
    );
    expect(screen.getByRole('button', { name: /Repeat — Every week on Tue & Fri/ })).toBeTruthy();
  });

  it('keeps missed-work and rolling-window choices behind More options', () => {
    render(
      <RepeatTaskControl
        value={createDefaultTaskRepeat('daily', '2026-08-11', 'America/Los_Angeles')}
        onChange={vi.fn()}
        today="2026-08-11"
        timezone="America/Los_Angeles"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Repeat — Every day/ }));
    expect(screen.queryByLabelText('When an occurrence is missed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByLabelText('When an occurrence is missed')).toBeTruthy();
    expect(screen.getByLabelText('Schedule ahead')).toBeTruthy();
  });
});
