/**
 * `tests/timeline` — what a schedule drag shows, and what it commits.
 *
 * @remarks
 * The launch review's three drag findings were all the same shape: the gesture had no visible
 * object, no statement of its outcome, and no way to reach off-screen dates. Each is gated here
 * against a scripted pointer drag through the real hook, with the plot given a fixed box so the
 * pointer-to-date projection runs for real rather than being stubbed out.
 *
 * The load-bearing assertion is the last one in each drag: the preview, the drop indicator, and
 * the value handed to `onReschedule` are all read from the same snapped span, so a test that finds
 * them agreeing is checking that the interface cannot promise one date and store another.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TimelineSpan } from '@/components/timeline/timeline-catalog';

import {
  DAY,
  DEFAULT_WINDOW,
  EPOCH,
  Fixture,
  catalog,
  controlFrames,
  row,
  stubLayout,
} from './harness';

afterEach(cleanup);

/** The fixture plot box: 1000px wide, spanning the 120-day default window. */
const PLOT = { left: 200, top: 100, width: 1000, height: 400 };
/** Pixels per day in {@link PLOT} against {@link DEFAULT_WINDOW}. */
const PX_PER_DAY = PLOT.width / 120;

/** Drive a pointer drag across a bar and return the element it started on. */
function dragBy(element: Element, fromX: number, byPx: number, atY = 200): void {
  fireEvent.pointerDown(element, { button: 0, clientX: fromX, clientY: atY, pointerId: 1 });
  act(() => {
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: fromX + byPx,
        clientY: atY,
        bubbles: true,
        pointerId: 1,
      }),
    );
  });
}

/** End a drag opened by {@link dragBy}. */
function release(element: Element): void {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
}

describe('a schedule drag carries the object', () => {
  it('pins a preview of the dragged row to the pointer, with its name and duration', () => {
    const restore = stubLayout(PLOT);
    try {
      render(<Fixture rows={[row('a', 10, 20)]} />);
      const bar = screen.getByRole('button', { name: /Project a — Planned/ });
      dragBy(bar, PLOT.left + 200, PX_PER_DAY * 10);

      const preview = document.querySelector('[data-timeline-drag-preview]');
      if (!(preview instanceof HTMLElement)) throw new Error('expected a drag preview');
      expect(preview.textContent).toContain('Project a');
      // Ten days moved, duration unchanged: Mar 21 – Mar 31, still 10 days.
      expect(preview.textContent).toContain('10 days');
      // Attached to the pointer, not to the row's old position.
      expect(preview.style.left).toBe(`${PLOT.left + 200 + PX_PER_DAY * 10 + 14}px`);
      expect(preview.style.top).toBe('214px');
      release(bar);
      expect(document.querySelector('[data-timeline-drag-preview]')).toBeNull();
    } finally {
      restore();
    }
  });

  it('does not show a preview for a press that never became a drag', () => {
    const restore = stubLayout(PLOT);
    try {
      render(<Fixture rows={[row('a', 10, 20)]} />);
      const bar = screen.getByRole('button', { name: /Project a — Planned/ });
      fireEvent.pointerDown(bar, { button: 0, clientX: 400, clientY: 200, pointerId: 1 });
      expect(document.querySelector('[data-timeline-drag-preview]')).toBeNull();
      release(bar);
    } finally {
      restore();
    }
  });
});

describe('a schedule drag says where the object will land', () => {
  it('applies the route interaction policy to foreign and context label rows', () => {
    const restore = stubLayout(PLOT);
    const activations: string[] = [];
    const routeCatalog = {
      ...catalog,
      object: (candidate: { readonly id: string; readonly name: string }) => ({
        kind: 'project' as const,
        id: candidate.id,
        organizationId: 'org-route',
        title: candidate.name,
      }),
      interaction: (candidate: { readonly id: string; readonly name: string }) => {
        if (candidate.id === 'context') {
          return { object: null, dragDisabled: true, actionScope: 'reference' as const };
        }
        return {
          object: {
            kind: 'project' as const,
            id: candidate.id,
            organizationId: candidate.id === 'foreign' ? 'org-foreign' : 'org-route',
            title: candidate.name,
          },
          dragDisabled: candidate.id === 'foreign',
          actionScope: candidate.id === 'foreign' ? ('reference' as const) : ('all' as const),
        };
      },
    };

    try {
      render(
        <Fixture
          rows={[row('local', 0, 5), row('foreign', 10, 15), row('context', 20, 25)]}
          catalogOverride={routeCatalog}
          onActivate={(id) => activations.push(id)}
        />,
      );

      const localLabel = screen
        .getByRole('gridcell', { name: 'Project local' })
        .closest('[role="row"]');
      const foreignLabel = screen
        .getByRole('gridcell', { name: 'Project foreign' })
        .closest('[role="row"]');
      const contextLabel = screen
        .getByRole('gridcell', { name: 'Project context' })
        .closest('[role="row"]');

      expect(localLabel).toHaveAttribute('data-object-id', 'local');
      expect(localLabel).toHaveClass('cursor-grab');
      expect(foreignLabel).toHaveAttribute('data-object-id', 'foreign');
      expect(foreignLabel).toHaveAttribute('data-object-action-scope', 'reference');
      expect(foreignLabel).not.toHaveClass('cursor-grab');
      expect(contextLabel).not.toHaveAttribute('data-object-id');

      fireEvent.click(screen.getByRole('gridcell', { name: 'Project foreign' }));
      fireEvent.click(screen.getByRole('gridcell', { name: 'Project context' }));
      expect(activations).toEqual(['foreign', 'context']);
    } finally {
      restore();
    }
  });

  it('marks the target row and states the snapped dates, and commits exactly those', () => {
    const restore = stubLayout(PLOT);
    const commits: { id: string; span: TimelineSpan }[] = [];
    try {
      render(
        <Fixture
          rows={[row('a', 10, 20), row('b', 40, 50)]}
          onReschedule={(id, span) => commits.push({ id, span })}
        />,
      );
      const bar = screen.getByRole('button', { name: /Project a — Planned/ });
      dragBy(bar, PLOT.left + 200, PX_PER_DAY * 7);

      const indicator = document.querySelector('[data-timeline-drop-indicator]');
      if (!(indicator instanceof HTMLElement)) throw new Error('expected a drop indicator');
      // It bands the row it will land in — row 'a', the first track.
      expect(indicator.style.top).toBe('0px');
      expect(indicator.style.height).toBe('56px');
      // …and reads out the dates in words.
      expect(indicator.textContent).toMatch(/Mar 18\s*–\s*Mar 28/);

      release(bar);
      expect(commits).toHaveLength(1);
      const committed = commits[0];
      if (!committed) throw new Error('expected a commit');
      expect(committed.id).toBe('a');
      // The dates the indicator promised are the dates that were stored.
      expect(committed.span.start).toBe(EPOCH + 17 * DAY);
      expect(committed.span.end).toBe(EPOCH + 27 * DAY);
      expect(document.querySelector('[data-timeline-drop-indicator]')).toBeNull();
    } finally {
      restore();
    }
  });

  it('schedules an undated row from its own lane, at the date under the pointer', () => {
    const restore = stubLayout(PLOT);
    const commits: { id: string; span: TimelineSpan }[] = [];
    try {
      render(
        <Fixture
          rows={[row('dated', 0, 5), row('undated', null, null)]}
          onReschedule={(id, span) => commits.push({ id, span })}
        />,
      );
      const lane = screen.getByRole('button', {
        name: /Project undated — not scheduled\. Drag across this row to schedule it\./,
      });
      // Press 30 days in, then drag out four more days.
      dragBy(lane, PLOT.left + PX_PER_DAY * 30, PX_PER_DAY * 4);
      release(lane);

      expect(commits).toHaveLength(1);
      const committed = commits[0];
      if (!committed) throw new Error('expected a commit');
      expect(committed.id).toBe('undated');
      // The press opens a one-day span at the date under the pointer; the drag extends its
      // trailing edge, so four days of travel yields a five-day project.
      expect(committed.span.start).toBe(EPOCH + 30 * DAY);
      expect(committed.span.end).toBe(EPOCH + 35 * DAY);
    } finally {
      restore();
    }
  });

  it('does not drag a dated row that its catalog marks read-only', () => {
    const restore = stubLayout(PLOT);
    const commits: { id: string; span: TimelineSpan }[] = [];
    const activations: string[] = [];
    const routeCatalog = {
      ...catalog,
      schedulable: (candidate: { readonly id: string }) => candidate.id !== 'foreign',
    };
    try {
      render(
        <Fixture
          rows={[row('local', 0, 5), row('foreign', 10, 20)]}
          catalogOverride={routeCatalog}
          onReschedule={(id, span) => commits.push({ id, span })}
          onActivate={(id) => activations.push(id)}
        />,
      );
      const bar = screen.getByRole('button', { name: /Project foreign — Planned/ });
      const track = bar.closest('[data-timeline-track="row"]');
      expect(track?.querySelectorAll('.cursor-ew-resize')).toHaveLength(0);

      fireEvent.click(bar);
      expect(activations).toEqual(['foreign']);

      dragBy(bar, PLOT.left + 200, PX_PER_DAY * 7);
      release(bar);

      expect(commits).toEqual([]);
      expect(document.querySelector('[data-timeline-drag-preview]')).toBeNull();
    } finally {
      restore();
    }
  });

  it('does not place an undated row that its catalog marks read-only', () => {
    const restore = stubLayout(PLOT);
    const commits: { id: string; span: TimelineSpan }[] = [];
    const routeCatalog = {
      ...catalog,
      schedulable: (candidate: { readonly id: string }) => candidate.id !== 'foreign',
    };
    try {
      render(
        <Fixture
          rows={[row('local', 0, 5), row('foreign', null, null)]}
          catalogOverride={routeCatalog}
          onReschedule={(id, span) => commits.push({ id, span })}
        />,
      );
      const lane = screen.getByRole('button', {
        name: 'Project foreign — not scheduled.',
      });
      dragBy(lane, PLOT.left + PX_PER_DAY * 30, PX_PER_DAY * 4);
      release(lane);

      expect(commits).toEqual([]);
    } finally {
      restore();
    }
  });

  it('does not propose cascade writes for rows that the catalog marks read-only', () => {
    const restore = stubLayout(PLOT);
    const routeCatalog = {
      ...catalog,
      schedulable: (candidate: { readonly id: string }) => candidate.id !== 'foreign',
    };
    try {
      render(
        <Fixture
          rows={[row('local', 0, 10, ['foreign']), row('foreign', 20, 30)]}
          catalogOverride={routeCatalog}
        />,
      );
      const bar = screen.getByRole('button', { name: /Project local — Planned/ });
      dragBy(bar, PLOT.left + 100, PX_PER_DAY * 20);
      release(bar);

      expect(screen.queryByText(/That pushes/)).toBeNull();
    } finally {
      restore();
    }
  });

  it('does not propagate a cascade through a read-only dependency', () => {
    const restore = stubLayout(PLOT);
    const routeCatalog = {
      ...catalog,
      schedulable: (candidate: { readonly id: string }) => candidate.id !== 'foreign',
    };
    try {
      render(
        <Fixture
          rows={[
            row('local', 0, 10, ['foreign']),
            row('foreign', 20, 30, ['local-after']),
            row('local-after', 40, 50),
          ]}
          catalogOverride={routeCatalog}
        />,
      );
      const bar = screen.getByRole('button', { name: /Project local — Planned/ });
      dragBy(bar, PLOT.left + 100, PX_PER_DAY * 30);
      release(bar);

      expect(screen.queryByText(/That pushes/)).toBeNull();
    } finally {
      restore();
    }
  });

  it('discards retained undo and cascade actions when scheduling permission is removed', () => {
    const restore = stubLayout(PLOT);
    const rows = [row('local', 0, 10, ['dependent']), row('dependent', 20, 30)];
    try {
      const view = render(<Fixture rows={rows} canSchedule />);
      const bar = screen.getByRole('button', { name: /Project local — Planned/ });
      dragBy(bar, PLOT.left + 100, PX_PER_DAY * 20);
      release(bar);

      expect(screen.getByRole('button', { name: 'Undo move of Project local' })).toBeVisible();
      expect(screen.getByText(/That pushes/)).toBeVisible();

      view.rerender(<Fixture rows={rows} canSchedule={false} />);

      expect(
        screen.queryByRole('button', { name: 'Undo move of Project local' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/That pushes/)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe('a drag held at an edge moves the timeline under it', () => {
  it('pans the window when the pointer sits in the horizontal edge zone, and stops on release', () => {
    const restore = stubLayout(PLOT);
    const frames = controlFrames();
    const setWindow = vi.fn();
    try {
      render(
        <Fixture
          rows={[row('a', 10, 20)]}
          viewport={{
            window: DEFAULT_WINDOW,
            scale: { ...DEFAULT_WINDOW, granularity: 'week', ticks: [] },
            setWindow,
            resetToToday: () => undefined,
            zoomIn: () => undefined,
            zoomOut: () => undefined,
            panEarlier: () => undefined,
            panLater: () => undefined,
          }}
        />,
      );
      const bar = screen.getByRole('button', { name: /Project a — Planned/ });
      // Drag to within 10px of the plot's right edge — deep inside the 64px zone.
      dragBy(bar, PLOT.left + 300, PLOT.left + PLOT.width - 10 - (PLOT.left + 300));
      expect(setWindow).not.toHaveBeenCalled();

      act(() => {
        frames.step();
      });
      expect(setWindow).toHaveBeenCalled();
      // The updater pans later: applied to the current window it must move both bounds forward.
      const updater = setWindow.mock.calls[0]?.[0] as (w: typeof DEFAULT_WINDOW) => {
        min: number;
        max: number;
      };
      const panned = updater(DEFAULT_WINDOW);
      expect(panned.min).toBeGreaterThan(DEFAULT_WINDOW.min);
      expect(panned.max - panned.min).toBe(DEFAULT_WINDOW.max - DEFAULT_WINDOW.min);

      release(bar);
      const callsAtRelease = setWindow.mock.calls.length;
      act(() => {
        frames.step();
      });
      expect(setWindow.mock.calls.length).toBe(callsAtRelease);
    } finally {
      frames.restore();
      restore();
    }
  });

  it('scrolls the row list when the pointer sits in the vertical edge zone', () => {
    const restore = stubLayout(PLOT);
    const frames = controlFrames();
    try {
      const { container } = render(
        <Fixture rows={[row('a', 10, 20), row('b', 30, 60), row('c', 5, 9)]} />,
      );
      const scroller = container.querySelector('.overflow-y-auto');
      if (!(scroller instanceof HTMLElement)) throw new Error('expected the scroll container');
      scroller.scrollTop = 0;

      const bar = screen.getByRole('button', { name: /Project a — Planned/ });
      // Well inside the plot horizontally, 6px above the container's bottom edge.
      fireEvent.pointerDown(bar, {
        button: 0,
        clientX: PLOT.left + 500,
        clientY: PLOT.top + PLOT.height - 6,
        pointerId: 1,
      });
      act(() => {
        frames.step();
      });
      expect(scroller.scrollTop).toBeGreaterThan(0);
      release(bar);
    } finally {
      frames.restore();
      restore();
    }
  });
});
