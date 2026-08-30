import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphInspectorHost } from '@/components/canvas/graph-inspector-host';

/** The host width the fake `ResizeObserver` and `getBoundingClientRect` report. */
let hostWidth = 1200;

/** What the docked column's pinned inner element reports. */
const COLUMN_WIDTH = 264;

beforeEach(() => {
  hostWidth = 1200;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(): void {
        this.callback(
          [{ contentRect: { width: hostWidth } } as unknown as ResizeObserverEntry],
          this,
        );
      }
      disconnect(): void {
        // no-op
      }
      unobserve(): void {
        // no-op
      }
    },
  );
  // The pinned inner column reports its own (narrower) width; everything else reports the host's.
  // That difference is the whole point of the `onDock` measurement, so the stub has to preserve it.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const isColumn = this.className.includes('clamp(16rem,22%,20rem)');
    return { width: isColumn ? COLUMN_WIDTH : hostWidth, height: 800 } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderHost(open: boolean, onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  render(
    <GraphInspectorHost
      aside={open ? <button type="button">Open task</button> : null}
      onClose={onClose}
    >
      <div data-testid="canvas">Canvas</div>
    </GraphInspectorHost>,
  );
  return { onClose };
}

describe('GraphInspectorHost', () => {
  it('docks the inspector as a sibling column on a wide host', () => {
    renderHost(true);
    const aside = screen.getByRole('complementary', { name: 'Selection details' });
    expect(aside).toBeInTheDocument();
    // A real column, not an overlay: it shares the row with the canvas rather than covering it.
    expect(aside).not.toHaveClass('absolute');
    expect(screen.getByTestId('canvas').closest('[inert]')).toBeNull();
  });

  it('collapses the docked column to zero width when nothing is selected', () => {
    renderHost(false);
    const aside = screen.getByRole('complementary', { name: 'Selection details' });
    expect(aside).toHaveClass('w-0');
    expect(aside).toHaveAttribute('inert');
  });

  it('covers the canvas and makes it inert on a host too narrow to dock', () => {
    hostWidth = 500;
    renderHost(true);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    // The canvas keeps its size — covering rather than shrinking is what makes the compact path
    // need no refit — but it stops taking input while the pane is over it.
    expect(screen.getByTestId('canvas').closest('[inert]')).not.toBeNull();
  });

  it('leaves focus alone while docked — a column beside the canvas is not a pane', () => {
    render(
      <>
        <button type="button">Outside</button>
        <GraphInspectorHost aside={<button type="button">Open task</button>} onClose={vi.fn()}>
          <div>Canvas</div>
        </GraphInspectorHost>
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();
    expect(outside).toHaveFocus();
  });

  it('takes focus for the covering pane and gives it back on close', () => {
    hostWidth = 500;
    const { rerender } = render(
      <>
        <button type="button">Opener</button>
        <GraphInspectorHost aside={null} onClose={vi.fn()}>
          <div>Canvas</div>
        </GraphInspectorHost>
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();

    rerender(
      <>
        <button type="button">Opener</button>
        <GraphInspectorHost aside={<button type="button">Open task</button>} onClose={vi.fn()}>
          <div>Canvas</div>
        </GraphInspectorHost>
      </>,
    );
    expect(opener).not.toHaveFocus();

    rerender(
      <>
        <button type="button">Opener</button>
        <GraphInspectorHost aside={null} onClose={vi.fn()}>
          <div>Canvas</div>
        </GraphInspectorHost>
      </>,
    );
    expect(opener).toHaveFocus();
  });

  it('answers Escape itself, since the canvas handler no longer sees the focus', () => {
    const { onClose } = renderHost(true);
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Selection details' }), {
      key: 'Escape',
      code: 'Escape',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports the canvas width that survives docking, not the host width', () => {
    const onDock = vi.fn();
    render(
      <GraphInspectorHost
        aside={<button type="button">Open task</button>}
        onClose={vi.fn()}
        onDock={onDock}
      >
        <div>Canvas</div>
      </GraphInspectorHost>,
    );
    // What the graph needs is the canvas that survives, not the row it sits in — panning against
    // the row's width would leave the selected node under the column it was meant to clear.
    expect(onDock).toHaveBeenCalledWith(hostWidth - COLUMN_WIDTH);
  });
});
