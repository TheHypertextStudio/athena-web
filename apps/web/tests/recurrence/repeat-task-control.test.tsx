/** Product-native repeat property behavior for the ordinary task composer. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultTaskRepeat,
  RepeatTaskControl,
} from '../../src/components/recurrence/repeat-task-control';

afterEach(cleanup);

describe('RepeatTaskControl', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Repeat — Does not repeat' }));
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
