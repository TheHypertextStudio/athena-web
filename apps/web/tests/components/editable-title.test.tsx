/**
 * Behavior tests for {@link EditableTitle} — the single-line in-place title editor.
 *
 * @remarks
 * Pins the contract the detail headings and rows depend on: it reads as text, only exposes an edit
 * affordance when `canEdit`, saves a trimmed changed value on Enter/blur, and reverts (never calling
 * `onSave`) on Escape, on an empty value, or when the value is unchanged.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditableTitle } from '../../src/components/editor/editable-title';

afterEach(cleanup);

/** Enter edit mode by activating the title, then return the edit input. */
function openEditor(ariaLabel: string): HTMLElement {
  fireEvent.click(screen.getByRole('button'));
  return screen.getByLabelText(ariaLabel);
}

describe('EditableTitle', () => {
  it('renders the value as plain, non-interactive text when not editable', () => {
    render(
      <EditableTitle value="Ship it" onSave={vi.fn()} canEdit={false} ariaLabel="Task title" />,
    );
    expect(screen.getByText('Ship it')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('saves a trimmed, changed value on Enter', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Old" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = openEditor('Task title');
    fireEvent.change(input, { target: { value: '  New title  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('New title');
  });

  it('saves on blur', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Old" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = openEditor('Task title');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('Renamed');
  });

  it('reverts on Escape without saving', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Keep me" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = openEditor('Task title');
    fireEvent.change(input, { target: { value: 'discard' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Keep me')).toBeTruthy();
  });

  it('never saves an empty title', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Keep me" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = openEditor('Task title');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not save when the value is unchanged', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Same" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = openEditor('Task title');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens on double-click (not single click) in doubleClick mode', () => {
    render(
      <EditableTitle
        value="Row"
        onSave={vi.fn()}
        canEdit
        activate="doubleClick"
        ariaLabel="Task title"
      />,
    );
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(screen.queryByLabelText('Task title')).toBeNull();
    fireEvent.doubleClick(trigger);
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });
});
