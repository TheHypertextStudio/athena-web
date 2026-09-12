import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CanvasFloatingColumn from '@/components/canvas/canvas-floating-column';
import { CANVAS_OVERLAY_GUTTER } from '@/components/canvas/canvas-viewport-insets';

describe('CanvasFloatingColumn', () => {
  it('is a named aside pinned to the right with the gutter plus any offset', () => {
    render(
      <CanvasFloatingColumn label="Athena" offsetRight={300}>
        <p>Hello</p>
      </CanvasFloatingColumn>,
    );
    expect(screen.getByRole('complementary', { name: 'Athena' })).toBeInTheDocument();
    expect(screen.getByTestId('canvas-floating-column').style.right).toBe(
      `${String(CANVAS_OVERLAY_GUTTER + 300)}px`,
    );
  });

  it('closes on Escape unless the child already claimed the key', () => {
    const onEscape = vi.fn();
    render(
      <CanvasFloatingColumn label="Athena" onEscape={onEscape}>
        <input aria-label="Plain" />
        <input
          aria-label="Claims escape"
          onKeyDown={(event) => {
            event.preventDefault();
          }}
        />
      </CanvasFloatingColumn>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Claims escape' }), { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Plain' }), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('takes focus itself when the focused control unmounts, so Escape still lands', () => {
    const onEscape = vi.fn();
    const view = render(
      <CanvasFloatingColumn label="Selection details" onEscape={onEscape}>
        <button type="button">Confirm</button>
      </CanvasFloatingColumn>,
    );
    screen.getByRole('button', { name: 'Confirm' }).focus();
    view.rerender(
      <CanvasFloatingColumn label="Selection details" onEscape={onEscape}>
        <p>Created</p>
      </CanvasFloatingColumn>,
    );
    const column = screen.getByTestId('canvas-floating-column');
    expect(document.activeElement).toBe(column);
    fireEvent.keyDown(column, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('leaves focus alone when it moves to another control', () => {
    render(
      <>
        <CanvasFloatingColumn label="Selection details">
          <button type="button">Inside</button>
        </CanvasFloatingColumn>
        <button type="button">Outside</button>
      </>,
    );
    screen.getByRole('button', { name: 'Inside' }).focus();
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
  });

  it('reports its width on mount and zero on unmount', () => {
    const onWidthChange = vi.fn();
    const view = render(
      <CanvasFloatingColumn label="Athena" onWidthChange={onWidthChange}>
        <p>Hello</p>
      </CanvasFloatingColumn>,
    );
    expect(onWidthChange).toHaveBeenCalledWith(expect.any(Number));
    view.unmount();
    expect(onWidthChange).toHaveBeenLastCalledWith(0);
  });
});
