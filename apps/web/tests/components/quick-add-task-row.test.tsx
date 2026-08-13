/**
 * Behavior tests for {@link QuickAddTaskRow} — the inline "type + Enter" task composer.
 *
 * @remarks
 * Pins the flow-preserving contract: Enter creates from a trimmed title, clears the field (which
 * never unmounts, so focus stays for the next entry), ignores an empty submit, and renders nothing
 * without edit rights.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickAddTaskRow } from '../../src/components/tasks/quick-add-task-row';
import { deferred } from '../support/deferred';

afterEach(cleanup);

/** The titles currently parked as refused, in order. */
function refusedTitles(): (string | null)[] {
  return [...document.querySelectorAll('[data-refused-title]')].map((node) => node.textContent);
}

describe('QuickAddTaskRow', () => {
  it('renders nothing without edit rights', () => {
    const { container } = render(<QuickAddTaskRow onAdd={vi.fn()} canEdit={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('creates from a trimmed title on Enter, then clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');
    fireEvent.change(input, { target: { value: '  Draft the vendor comparison  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Draft the vendor comparison');
    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('ignores an empty submit', () => {
    const onAdd = vi.fn();
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText('New task title');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('accepts the next title while the previous one is still saving', async () => {
    const first = deferred<undefined>();
    const onAdd = vi
      .fn<(title: string) => Promise<void>>()
      .mockImplementationOnce(async () => {
        await first.promise;
      })
      .mockResolvedValue(undefined);
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');

    fireEvent.change(input, { target: { value: 'Draft the brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The composer's job is to keep up with someone typing, not to make them wait on the network
    // between entries. The field clears in the submit turn and stays usable.
    await waitFor(() => {
      expect(input.value).toBe('');
    });
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'Send it round' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAdd).toHaveBeenNthCalledWith(1, 'Draft the brief');
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Send it round');
    first.resolve(undefined);
  });

  it('keeps every failed title, not just the first one back', async () => {
    const onAdd = vi
      .fn<(title: string) => Promise<void>>()
      .mockRejectedValue(new Error('save failed'));
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');

    fireEvent.change(input, { target: { value: 'Draft the brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(refusedTitles()).toEqual(['Draft the brief']);
    });

    fireEvent.change(input, { target: { value: 'Send it round' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Restoring only into an empty field loses the second title entirely: the first failure has
    // already refilled the box, so the second finds it occupied and drops what was typed. Both
    // were entered and both were refused, so both have to come back.
    await waitFor(() => {
      expect(refusedTitles()).toEqual(['Draft the brief', 'Send it round']);
    });
  });

  it('keeps focus on the field across an entry', async () => {
    const onAdd = vi.fn<(title: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');
    input.focus();

    fireEvent.change(input, { target: { value: 'Draft the brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Disabling the field moved focus off it, so the next Enter went nowhere and the typing
    // rhythm broke on every single entry.
    await waitFor(() => {
      expect(input.value).toBe('');
    });
    expect(document.activeElement).toBe(input);
  });

  it('gives back a failed title instead of losing it', async () => {
    const onAdd = vi
      .fn<(title: string) => Promise<void>>()
      .mockRejectedValue(new Error('save failed'));
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');

    fireEvent.change(input, { target: { value: 'Draft the brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Clearing optimistically is only safe if a refusal hands the words back; otherwise the
    // composer quietly eats what someone typed.
    await waitFor(() => {
      expect(refusedTitles()).toEqual(['Draft the brief']);
    });
    expect(screen.getByRole('alert')).not.toBeNull();
    // The field itself stays free for the next task rather than being refilled behind the person.
    expect(input.value).toBe('');
  });

  it('retries a refused title and clears its row on success', async () => {
    const onAdd = vi
      .fn<(title: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(undefined);
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');

    fireEvent.change(input, { target: { value: 'Draft the brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(refusedTitles()).toEqual(['Draft the brief']);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry adding Draft the brief' }));

    // Keeping the words is only half of it; there has to be a way to send them again.
    await waitFor(() => {
      expect(refusedTitles()).toEqual([]);
    });
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Draft the brief');
  });

  it('discards a refused title on request', async () => {
    const onAdd = vi
      .fn<(title: string) => Promise<void>>()
      .mockRejectedValue(new Error('save failed'));
    render(<QuickAddTaskRow onAdd={onAdd} canEdit />);
    const input = screen.getByLabelText<HTMLInputElement>('New task title');

    fireEvent.change(input, { target: { value: 'Draft the brief' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(refusedTitles()).toEqual(['Draft the brief']);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Discard Draft the brief' }));

    expect(refusedTitles()).toEqual([]);
  });
});
