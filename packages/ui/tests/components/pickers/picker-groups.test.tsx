import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OptionPicker } from '../../../src/components/pickers/OptionPicker';

describe('OptionPicker groups', () => {
  it('renders grouped choices and a footer action in the same popover', async () => {
    render(
      <OptionPicker
        options={[
          { value: 'now', label: 'Today', group: 'Current' },
          { value: 'later', label: 'Next week', group: 'Upcoming' },
        ]}
        value={null}
        onChange={vi.fn()}
        placeholder="Set cycle"
        ariaLabel="Cycle"
        footer={<button type="button">Go to date…</button>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Cycle — not set/ }));
    expect(await screen.findByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to date…' })).toBeInTheDocument();
  });
});
