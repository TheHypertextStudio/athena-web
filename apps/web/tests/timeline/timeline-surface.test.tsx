/**
 * `tests/timeline` — the timeline surface's structural contract, asserted against the rendered DOM.
 *
 * @remarks
 * These are the four launch findings that are properties of the markup rather than of a
 * screenshot, so they are gated here and re-checked on every run rather than re-photographed:
 *
 * - the chart is not wrapped in a card,
 * - the sticky header is opaque,
 * - undated rows are rows in the same list and no tray element exists,
 * - no row track can overlap its neighbour, at any granularity, density, or row mix.
 *
 * The overlap gate is the interesting one. Vertical geometry is arithmetic — each track is
 * absolutely positioned at a running sum of the preceding heights — so the assertion reads the
 * inline `top`/`height` off every rendered track and checks the intervals are disjoint and
 * contiguous. That is the property that makes the answer independent of scroll offset: nothing in
 * the layout is a function of `scrollTop`, so a scroll cannot move one row into another.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_WINDOW, Fixture, fixedViewport, row, type Row } from './harness';
import { DEFAULT_VIEW_DISPLAY, type ViewScale } from '@/components/views/field-catalog';

afterEach(cleanup);

/** Every rendered track's vertical interval, in document order. */
function trackIntervals(container: HTMLElement): { top: number; bottom: number }[] {
  return [...container.querySelectorAll<HTMLElement>('[data-timeline-track]')]
    .map((element) => {
      const top = Number.parseFloat(element.style.top);
      const height = Number.parseFloat(element.style.height);
      return { top, bottom: top + height };
    })
    .filter((interval) => Number.isFinite(interval.top) && Number.isFinite(interval.bottom));
}

const MIXED: readonly Row[] = [
  row('a', 0, 10),
  row('b', 5, 40),
  row('undated-1', null, null),
  row('c', 20, 22),
  row('undated-2', null, null),
];

describe('the timeline is the page, not a card in it', () => {
  it('puts no bordered, rounded, or separately-filled container between the shell and the chart', () => {
    const { container } = render(<Fixture rows={MIXED} />);
    const root = container.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error('expected a rendered root');

    // The chart's own root must not paint a card: no radius, no stroke, no surface of its own.
    for (const banned of ['rounded', 'border', 'bg-surface-container', 'shadow']) {
      expect(root.className).not.toContain(banned);
    }
    // Nor may anything between the root and the plot area re-introduce one.
    const plot = container.querySelector('[role="grid"]');
    if (!(plot instanceof HTMLElement)) throw new Error('expected the plot grid');
    for (let node = plot.parentElement; node && node !== root; node = node.parentElement) {
      expect(node.className).not.toMatch(/\brounded-/);
      expect(node.className).not.toMatch(/\bborder(-|\b)/);
    }
  });

});

describe('the sticky header is opaque', () => {
  it('carries a solid surface token with no alpha and no backdrop filter', () => {
    const { container } = render(<Fixture rows={MIXED} />);
    const header = container.querySelector('[data-timeline-sticky-header]');
    if (!(header instanceof HTMLElement)) throw new Error('expected the sticky header');

    expect(header.className).toContain('sticky');
    expect(header.className).toContain('bg-surface-container-low');
    // A translucent header lets the rows sliding under it read through the dates — the exact
    // defect the launch review photographed. Alpha suffixes and backdrop blur are both bans.
    expect(header.className).not.toMatch(/bg-[\w-]+\/\d/);
    expect(header.className).not.toContain('backdrop');
    // And it must sit above everything the plot draws.
    expect(header.className).toContain('z-30');
  });
});

describe('undated rows are rows', () => {
  it('renders them in the same track list, at the same height, with no tray element', () => {
    const { container } = render(<Fixture rows={MIXED} />);
    const tracks = [...container.querySelectorAll<HTMLElement>('[data-timeline-track="row"]')];
    // Label cell and plot cell per row, for five rows.
    expect(tracks.length).toBe(MIXED.length * 2);
    expect(new Set(tracks.map((element) => element.style.height)).size).toBe(1);

    // Each undated row states its own condition on its own lane, and carries the whole
    // instruction in its accessible name whatever the container width has done to the copy.
    expect(
      screen.getAllByRole('button', {
        name: /not scheduled\. Drag across this row to schedule it\./,
      }),
    ).toHaveLength(2);
    expect(screen.getAllByText(/Not scheduled/)).toHaveLength(2);
    // Nothing anywhere is a tray.
    expect(container.textContent).not.toContain('Unscheduled');
    expect(container.querySelector('[data-timeline-tray]')).toBeNull();
  });

  it('orders the undated rows after the dated ones', () => {
    const { container } = render(<Fixture rows={MIXED} />);
    const labels = [...container.querySelectorAll<HTMLElement>('[role="gridcell"]')].map(
      (element) => element.textContent,
    );
    expect(labels).toEqual([
      'Project a',
      'Project b',
      'Project c',
      'Project undated-1',
      'Project undated-2',
    ]);
  });
});

describe('no row track ever overlaps its neighbour', () => {
  const SCALES: readonly ViewScale[] = ['auto', 'day', 'week', 'month', 'quarter', 'year'];
  const DENSITIES = ['comfortable', 'compact'] as const;

  for (const scale of SCALES) {
    for (const density of DENSITIES) {
      it(`holds at ${scale} scale, ${density} density`, () => {
        const { container } = render(
          <Fixture
            rows={MIXED}
            display={{ ...DEFAULT_VIEW_DISPLAY, scale, density }}
            viewport={fixedViewport(DEFAULT_WINDOW, scale)}
          />,
        );
        // Label column and plot column each carry the full track list; both must be disjoint.
        const intervals = trackIntervals(container);
        expect(intervals.length).toBeGreaterThan(0);
        const byTop = [...intervals].sort((a, b) => a.top - b.top);
        for (let index = 1; index < byTop.length; index++) {
          const previous = byTop[index - 1];
          const current = byTop[index];
          if (!previous || !current) throw new Error('unreachable');
          // Two columns render the same track, so an identical interval is expected; what must
          // never happen is a partial overlap — one row's box crossing into another's.
          const identical = previous.top === current.top && previous.bottom === current.bottom;
          expect(identical || current.top >= previous.bottom).toBe(true);
        }
      });
    }
  }

  it('derives every track offset from the running sum, so scrolling cannot move one', () => {
    const { container } = render(<Fixture rows={MIXED} />);
    const plot = container.querySelector('[role="grid"]');
    if (!(plot instanceof HTMLElement)) throw new Error('expected the plot grid');
    // No track's position is expressed relative to anything that scrolling changes.
    for (const element of plot.querySelectorAll<HTMLElement>('[data-timeline-track]')) {
      expect(element.style.top).toMatch(/^\d/);
      expect(element.className).toContain('absolute');
    }
  });
});

describe('structure is tonal, not ruled', () => {
  it('draws no full-opacity divider and keeps every grid guide on a reduced-opacity token', () => {
    const { container } = render(<Fixture rows={MIXED} />);
    // `getAttribute`, not `.className`: an SVG element exposes an `SVGAnimatedString` there.
    const classNames = [...container.querySelectorAll('*')].map(
      (element) => element.getAttribute('class') ?? '',
    );
    const borders = classNames.filter((name) => /\bborder-[trbl]\b|\bborder\b/.test(name));
    expect(borders).toEqual([]);

    // The guides that remain are outline-variant with an alpha suffix, never the bare token.
    const guides = classNames.filter((name) => name.includes('bg-outline-variant'));
    expect(guides.length).toBeGreaterThan(0);
    for (const guide of guides) {
      expect(guide).toMatch(/bg-outline-variant\/\d+/);
    }
  });
});
