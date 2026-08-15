import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DragHandle } from '../../src/components/atoms/DragHandle';
import { computeDropIndex, useReorderable } from '../../src/hooks/use-reorderable';

const ITEMS = [
  { id: 'a', name: 'Triage' },
  { id: 'b', name: 'Building' },
  { id: 'c', name: 'Shipped' },
  { id: 'd', name: 'Archived' },
] as const;

const IDS = ITEMS.map((item) => item.id);

function nameOf(id: string): string {
  return ITEMS.find((item) => item.id === id)?.name ?? id;
}

interface HarnessProps {
  readonly onReorder: (id: string, toIndex: number) => void;
  readonly disabled?: boolean;
}

/** A minimal surface that renders the binding the way a real list would. */
function Harness({ onReorder, disabled }: HarnessProps): React.JSX.Element {
  const { itemProps, handleProps, draggingId, liveMessage } = useReorderable({
    itemIds: IDS,
    onReorder,
    describeItem: nameOf,
    disabled,
  });
  return (
    <div>
      <p aria-live="polite" data-testid="live">
        {liveMessage}
      </p>
      <p data-testid="dragging">{draggingId ?? ''}</p>
      <ul>
        {ITEMS.map((item) => (
          <li key={item.id} data-testid={`row-${item.id}`} {...itemProps(item.id)}>
            <DragHandle data-testid={`grip-${item.id}`} {...handleProps(item.id)} />
            <span>{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Give a row a real box so the drop-edge midpoint test has something to measure. */
function stubRect(element: HTMLElement, top: number, height: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

/**
 * Dispatch a drag event carrying pointer coordinates.
 *
 * @remarks
 * jsdom has no `DragEvent`, so Testing Library's `fireEvent.dragOver` drops `clientY` on the floor.
 * A `MouseEvent` under the drag event's name carries the coordinate through to React's synthetic
 * drag event, which is all the hook reads.
 */
function fireDrag(element: HTMLElement, type: string, clientY = 0): void {
  fireEvent(element, new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
}

function grip(id: string): HTMLElement {
  return screen.getByTestId(`grip-${id}`);
}

function liveText(): string {
  return screen.getByTestId('live').textContent;
}

describe('computeDropIndex', () => {
  it('lands an item moving down after the row it passed', () => {
    expect(computeDropIndex(0, 2, 'below')).toBe(2);
  });

  it('lands an item moving up on the slot it displaced', () => {
    expect(computeDropIndex(3, 1, 'above')).toBe(1);
  });

  it('holds an item still when it is dropped on its own row', () => {
    expect(computeDropIndex(1, 1, 'above')).toBe(1);
    expect(computeDropIndex(1, 1, 'below')).toBe(1);
  });

  it('treats the near edge of the neighbour below as no move at all', () => {
    expect(computeDropIndex(0, 1, 'above')).toBe(0);
  });

  it('reaches the first slot', () => {
    expect(computeDropIndex(2, 0, 'above')).toBe(0);
  });

  it('reaches the last slot', () => {
    expect(computeDropIndex(0, 3, 'below')).toBe(3);
  });
});

describe('useReorderable — keyboard', () => {
  it('commits the destination index when a grabbed row is moved and dropped', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('a').focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith('a', 1);
  });

  it('carries a row across several slots in one grab', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('a').focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(onReorder).toHaveBeenCalledWith('a', 3);
  });

  it('stops at the end of the bucket instead of running past it', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('d').focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('writes nothing when a move is abandoned', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('a').focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Escape}');

    expect(onReorder).not.toHaveBeenCalled();
    expect(grip('a')).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignores Escape on a grip that is holding nothing', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('a').focus();
    await user.keyboard('{Escape}');

    expect(liveText()).toBe('');
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('toggles the pressed state as the row is grabbed and released', async () => {
    const user = userEvent.setup();
    render(<Harness onReorder={vi.fn()} />);

    expect(grip('b')).toHaveAttribute('aria-pressed', 'false');
    grip('b').focus();
    await user.keyboard(' ');
    expect(grip('b')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard(' ');
    expect(grip('b')).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the held row so the surface can lift it', async () => {
    const user = userEvent.setup();
    render(<Harness onReorder={vi.fn()} />);

    grip('b').focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('row-b')).toHaveAttribute('data-grabbed');
  });

  it('re-announces the row by name at every step of the move', async () => {
    const user = userEvent.setup();
    render(<Harness onReorder={vi.fn()} />);

    grip('a').focus();
    await user.keyboard('{Enter}');
    const grabbed = liveText();
    await user.keyboard('{ArrowDown}');
    const afterFirst = liveText();
    await user.keyboard('{ArrowDown}');
    const afterSecond = liveText();

    expect(grabbed).toContain('Triage');
    expect(afterFirst).not.toBe(grabbed);
    expect(afterSecond).not.toBe(afterFirst);
    expect(afterSecond).toContain('Triage');
  });

  it('announces an abandoned move too', async () => {
    const user = userEvent.setup();
    render(<Harness onReorder={vi.fn()} />);

    grip('a').focus();
    await user.keyboard('{Enter}{ArrowDown}');
    const moved = liveText();
    await user.keyboard('{Escape}');

    expect(liveText()).not.toBe(moved);
    expect(liveText()).toContain('Triage');
  });

  it('keeps focus on the grip through a whole gesture', async () => {
    const user = userEvent.setup();
    render(<Harness onReorder={vi.fn()} />);

    grip('a').focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');

    expect(document.activeElement).toBe(grip('a'));
  });

  it('moves a row one slot with Alt and no grab step', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('c').focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith('c', 1);
    expect(grip('c')).toHaveAttribute('aria-pressed', 'false');
    expect(liveText()).toContain('Shipped');
  });

  it('writes nothing when an Alt move would run off the top', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('a').focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('leaves an unmodified arrow key to the surface when nothing is grabbed', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    grip('c').focus();
    await user.keyboard('{ArrowUp}');

    expect(onReorder).not.toHaveBeenCalled();
    expect(liveText()).toBe('');
  });

  it('leaves keys it does not own alone', async () => {
    const user = userEvent.setup();
    render(<Harness onReorder={vi.fn()} />);

    grip('c').focus();
    await user.keyboard('x');

    expect(liveText()).toBe('');
  });

  it('grabs on a pointer press of the grip', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    await user.click(grip('b'));
    expect(grip('b')).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{ArrowDown}');
    await user.click(grip('b'));

    expect(onReorder).toHaveBeenCalledWith('b', 2);
  });
});

describe('useReorderable — pointer', () => {
  it('publishes the edge the pointer is nearest so the surface can draw the line', () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const target = screen.getByTestId('row-c');
    stubRect(target, 80, 20);

    fireDrag(screen.getByTestId('row-a'), 'dragstart');
    fireDrag(target, 'dragover', 95);
    expect(target).toHaveAttribute('data-drop-edge', 'below');

    fireDrag(target, 'dragover', 82);
    expect(target).toHaveAttribute('data-drop-edge', 'above');
  });

  it('marks the row in flight and reports it to the surface', () => {
    render(<Harness onReorder={vi.fn()} />);
    const source = screen.getByTestId('row-a');

    fireDrag(source, 'dragstart');

    expect(source).toHaveAttribute('data-dragging');
    expect(screen.getByTestId('dragging')).toHaveTextContent('a');
  });

  it('commits the drop index the edge resolves to', () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const target = screen.getByTestId('row-c');
    stubRect(target, 80, 20);

    fireDrag(screen.getByTestId('row-a'), 'dragstart');
    fireDrag(target, 'dragover', 95);
    fireDrag(target, 'drop', 95);

    expect(onReorder).toHaveBeenCalledWith('a', 2);
    expect(liveText()).toContain('Triage');
    expect(screen.getByTestId('dragging')).toHaveTextContent('');
  });

  it('resolves a drop that never got a dragover from the pointer itself', () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const target = screen.getByTestId('row-c');
    stubRect(target, 80, 20);

    fireDrag(screen.getByTestId('row-a'), 'dragstart');
    fireDrag(target, 'drop', 82);

    expect(onReorder).toHaveBeenCalledWith('a', 1);
  });

  it('clears the insertion line when the pointer leaves the row', () => {
    render(<Harness onReorder={vi.fn()} />);
    const target = screen.getByTestId('row-c');
    stubRect(target, 80, 20);

    fireDrag(screen.getByTestId('row-a'), 'dragstart');
    fireDrag(target, 'dragover', 95);
    fireDrag(target, 'dragleave');

    expect(target).not.toHaveAttribute('data-drop-edge');
  });

  it('draws no line on the row being dragged', () => {
    render(<Harness onReorder={vi.fn()} />);
    const source = screen.getByTestId('row-a');
    stubRect(source, 0, 20);

    fireDrag(source, 'dragstart');
    fireDrag(source, 'dragover', 15);

    expect(source).not.toHaveAttribute('data-drop-edge');
  });

  it('writes nothing for a drop that lands where the row already was', () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const target = screen.getByTestId('row-b');
    stubRect(target, 20, 20);

    fireDrag(screen.getByTestId('row-a'), 'dragstart');
    fireDrag(target, 'dragover', 25);
    fireDrag(target, 'drop', 25);

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('ignores a drop from a drag it never started', () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);

    fireDrag(screen.getByTestId('row-c'), 'drop', 10);

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('forgets the gesture when the drag ends without a drop', () => {
    render(<Harness onReorder={vi.fn()} />);
    const source = screen.getByTestId('row-a');

    fireDrag(source, 'dragstart');
    fireDrag(source, 'dragend');

    expect(source).not.toHaveAttribute('data-dragging');
    expect(screen.getByTestId('dragging')).toHaveTextContent('');
  });

  it('writes a payload when the browser supplies a dataTransfer', () => {
    render(<Harness onReorder={vi.fn()} />);
    const setData = vi.fn();
    const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { setData, effectAllowed: 'none' },
    });

    fireEvent(screen.getByTestId('row-a'), event);

    expect(setData).toHaveBeenCalledWith(expect.any(String), 'a');
  });

  it('makes every row a drag source and suppresses the stray text selection', () => {
    render(<Harness onReorder={vi.fn()} />);
    const row = screen.getByTestId('row-a');

    expect(row).toHaveAttribute('draggable', 'true');
    expect(row.className).toContain('select-none');
  });
});

describe('useReorderable — disabled', () => {
  it('contributes no drag props to a row', () => {
    render(<Harness onReorder={vi.fn()} disabled />);
    const row = screen.getByTestId('row-a');

    expect(row).not.toHaveAttribute('draggable');
    expect(row.className).toBe('');
  });

  it('renders an inert grip that the keyboard cannot grab', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} disabled />);

    expect(grip('a')).toBeDisabled();
    expect(grip('a')).toHaveAttribute('aria-pressed', 'false');

    grip('a').focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');

    expect(onReorder).not.toHaveBeenCalled();
    expect(liveText()).toBe('');
  });

  it('keeps naming the row it belongs to', () => {
    render(<Harness onReorder={vi.fn()} disabled />);
    expect(grip('a').getAttribute('aria-label')).toContain('Triage');
  });
});
