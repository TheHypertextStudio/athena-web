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

afterEach(cleanup);

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
});
