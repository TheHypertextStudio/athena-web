/**
 * Behavior tests for {@link QuickAddRow} — the shared inline "type a name, press Enter" composer.
 *
 * @remarks
 * The behavior that matters is what happens between two entries. The field clears and refocuses in
 * the same turn as the submit, so the next name can be typed while the previous one is still in
 * flight — which is only safe because a refusal hands the words back as its own retryable row
 * rather than writing them over a field that now belongs to something else. These cases pin both
 * halves of that bargain, and the `noun` prop that keeps one implementation serving tasks and
 * milestones alike.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickAddRow } from '../../../src/components/views/quick-add-row';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Type a name into the row and submit it with Enter. */
function submit(value: string, noun = 'task'): HTMLInputElement {
  const field = screen.getByLabelText<HTMLInputElement>(`New ${noun} name`);
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
  return field;
}

describe('QuickAddRow', () => {
  it('renders nothing when the viewer may not create', () => {
    const { container } = render(<QuickAddRow onAdd={vi.fn()} canEdit={false} noun="task" />);
    expect(container.firstChild).toBeNull();
  });

  it('names its field and placeholder from the noun it creates', () => {
    render(<QuickAddRow onAdd={vi.fn()} canEdit noun="milestone" />);
    expect(screen.getByLabelText('New milestone name')).toBeTruthy();
    expect(screen.getByPlaceholderText('Add a milestone…')).toBeTruthy();
  });

  it('takes an explicit placeholder over the derived one', () => {
    render(
      <QuickAddRow onAdd={vi.fn()} canEdit noun="task" placeholder="Add a task to this cycle…" />,
    );
    expect(screen.getByPlaceholderText('Add a task to this cycle…')).toBeTruthy();
  });

  it('clears and keeps focus in the same turn as the submit', async () => {
    const onAdd = vi.fn(() => new Promise<void>(() => undefined));
    render(<QuickAddRow onAdd={onAdd} canEdit noun="task" />);

    const field = submit('Write the spec');

    expect(onAdd).toHaveBeenCalledWith('Write the spec');
    // Cleared and focused before anything is awaited, so the next entry can be typed immediately.
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    await waitFor(() => {
      expect(field.value).toBe('');
    });
  });

  it('accepts the next name while the previous one is still saving', async () => {
    const settle: (() => void)[] = [];
    const onAdd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle.push(resolve);
        }),
    );
    render(<QuickAddRow onAdd={onAdd} canEdit noun="task" />);

    // The whole reason the field clears before the round trip: a second entry must go in while the
    // first is still outstanding, not after it.
    submit('First');
    submit('Second');

    expect(onAdd).toHaveBeenNthCalledWith(1, 'First');
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Second');

    settle.forEach((resolve) => {
      resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Retry adding/ })).toBeNull();
    });
  });

  it('trims the submitted name and ignores a blank one', () => {
    const onAdd = vi.fn(async () => undefined);
    render(<QuickAddRow onAdd={onAdd} canEdit noun="task" />);

    submit('   ');
    expect(onAdd).not.toHaveBeenCalled();

    submit('  Padded  ');
    expect(onAdd).toHaveBeenCalledWith('Padded');
  });

  it('parks every refused submission as its own row rather than one shared box', async () => {
    const onAdd = vi.fn(() => Promise.reject(new Error('nope')));
    render(<QuickAddRow onAdd={onAdd} canEdit noun="task" />);

    submit('First');
    submit('Second');

    // Two refusals, two rows — putting them back one at a time into a single field would lose one.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry adding First' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Retry adding Second' })).toBeTruthy();
  });

  it('retries a refused submission and clears its row once it lands', async () => {
    const onAdd = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValue(undefined);
    render(<QuickAddRow onAdd={onAdd} canEdit noun="task" />);

    submit('Flaky');
    const retry = await screen.findByRole('button', { name: 'Retry adding Flaky' });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry adding Flaky' })).toBeNull();
    });
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Flaky');
  });

  it('discards a refused submission without resubmitting it', async () => {
    const onAdd = vi.fn(() => Promise.reject(new Error('nope')));
    render(<QuickAddRow onAdd={onAdd} canEdit noun="task" />);

    submit('Unwanted');
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Unwanted' }));

    await waitFor(() => {
      expect(screen.queryByText('Unwanted')).toBeNull();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
