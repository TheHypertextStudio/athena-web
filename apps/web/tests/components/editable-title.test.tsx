/**
 * Behavior tests for {@link EditableTitle} — the single-line in-place title editor.
 *
 * @remarks
 * Pins the contract the detail headings and rows depend on: it reads as text (or as an always-
 * editable input, never a click-to-save toggle) when `canEdit`, autosaves a trimmed changed value
 * on a debounce, and never fires `onSave` for an empty or unchanged value.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditableTitle } from '../../src/components/editor/editable-title';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EditableTitle', () => {
  it('renders the value as plain, non-interactive text when not editable', () => {
    render(
      <EditableTitle value="Ship it" onSave={vi.fn()} canEdit={false} ariaLabel="Task title" />,
    );
    expect(screen.getByText('Ship it')).toBeTruthy();
    expect(screen.queryByLabelText('Task title')).toBeNull();
  });

  it('is always an editable input, never a click-to-edit toggle', () => {
    render(<EditableTitle value="Old" onSave={vi.fn()} canEdit ariaLabel="Task title" />);
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });

  it('autosaves a trimmed, changed value after a quiet debounce, without disabling the field', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Old" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = screen.getByLabelText('Task title');
    fireEvent.change(input, { target: { value: '  New title  ' } });
    expect(input.hasAttribute('disabled')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('New title');
  });

  it('forces an immediate save on Enter without waiting for the debounce, and blurs', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Old" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = screen.getByLabelText<HTMLInputElement>('Task title');
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('New title');
    expect(document.activeElement).not.toBe(input);
  });

  it('does not re-fire the pending debounce after an Enter-forced save of the same value', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Old" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = screen.getByLabelText('Task title');
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('reverts on Escape without saving', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Keep me" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = screen.getByLabelText('Task title');
    fireEvent.change(input, { target: { value: 'discard' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>('Task title').value).toBe('Keep me');
  });

  it('never saves an empty title', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Keep me" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = screen.getByLabelText('Task title');
    fireEvent.change(input, { target: { value: '   ' } });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reverts an empty draft to the last saved title on blur', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Keep me" onSave={onSave} canEdit ariaLabel="Task title" />);
    const input = screen.getByLabelText<HTMLInputElement>('Task title');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(input.value).toBe('Keep me');
  });

  it('does not save when the value is unchanged', () => {
    const onSave = vi.fn();
    render(<EditableTitle value="Same" onSave={onSave} canEdit ariaLabel="Task title" />);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('in doubleClick mode a single click opens the row after a short delay', () => {
    const onActivate = vi.fn();
    render(
      <EditableTitle
        value="Row"
        onSave={vi.fn()}
        canEdit
        activate="doubleClick"
        onActivate={onActivate}
        ariaLabel="Task title"
      />,
    );
    fireEvent.click(screen.getByText('Row'));
    expect(onActivate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('in doubleClick mode a double click edits and cancels the pending open', () => {
    const onActivate = vi.fn();
    render(
      <EditableTitle
        value="Row"
        onSave={vi.fn()}
        canEdit
        activate="doubleClick"
        onActivate={onActivate}
        ariaLabel="Task title"
      />,
    );
    const el = screen.getByText('Row');
    fireEvent.click(el);
    fireEvent.doubleClick(el);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });
});
