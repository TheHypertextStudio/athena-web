/**
 * The time-estimate picker: common durations, a typed time committed with Enter, and clearing,
 * each reported in whole minutes.
 */
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EstimateTimePicker } from '@/components/pickers/estimate-time-picker';

/** Open the picker and return its typed-time field. */
async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: /^Time estimate/ }));
  return screen.findByRole('textbox');
}

describe('EstimateTimePicker', () => {
  it('reports a chosen duration in minutes and closes', async () => {
    const onChange = vi.fn();
    render(<EstimateTimePicker value={null} onChange={onChange} />);

    await openPicker();
    const option = await screen.findByRole('option', { name: /0:30/ });
    fireEvent.click(within(option).getByRole('button'));

    expect(onChange).toHaveBeenCalledWith(30);
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('commits a typed time with Enter', async () => {
    const onChange = vi.fn();
    render(<EstimateTimePicker value={null} onChange={onChange} />);

    const field = await openPicker();
    fireEvent.change(field, { target: { value: '1h 15' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('offers nothing to commit for text that is not a time', async () => {
    const onChange = vi.fn();
    render(<EstimateTimePicker value={null} onChange={onChange} />);

    const field = await openPicker();
    fireEvent.change(field, { target: { value: 'soon' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears a set estimate', async () => {
    const onChange = vi.fn();
    render(<EstimateTimePicker value={45} onChange={onChange} />);

    expect(screen.getByRole('button', { name: /^Time estimate/ })).toHaveTextContent('0:45');
    await openPicker();
    const rows = await screen.findAllByRole('option');
    const clear = rows[0];
    expect(clear).toBeDefined();
    if (clear === undefined) return;
    fireEvent.click(within(clear).getByRole('button'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows a time that is not one of the durations', () => {
    render(<EstimateTimePicker value={25} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^Time estimate/ })).toHaveTextContent('0:25');
  });

  it('renders no control when read-only', () => {
    render(<EstimateTimePicker value={45} onChange={vi.fn()} readOnly />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
