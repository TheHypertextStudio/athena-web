/**
 * Unit tests for the timeline's layout and geometry models.
 *
 * @remarks
 * Two architectural rules are enforced here because violating either reintroduces a defect the
 * rewrite existed to remove:
 *
 * - **Row height is uniform.** It derives only from the display options, never from a row, so no
 *   row can be taller than another in a single render. This is what keeps virtualization
 *   measurement-free and lets dependency edges route from arithmetic rather than the DOM.
 * - **Grouping is rendered, not discarded.** The previous lens flattened groups into bare rows, so
 *   the toolbar's "Group by" silently did nothing.
 *
 * Undated rows are also asserted to be *partitioned out* rather than plotted at offset zero, which
 * is what made unscheduled Projects read as broken rows.
 */
import { describe, expect, it } from 'vitest';

import type { AppliedView } from '@/components/views/apply-view';
import { DEFAULT_VIEW_DISPLAY, type ViewDisplayState } from '@/components/views/field-catalog';
import {
  type TimelineCatalog,
  isAnchor,
  resolveSpan,
} from '@/components/timeline/timeline-catalog';
import {
  BAR_HEIGHT,
  barInsetFor,
  hitHeightFor,
  rowHeightFor,
} from '@/components/timeline/timeline-geometry';
import { buildTimelineLayout } from '@/components/timeline/timeline-layout';

/** A minimal row fixture: an id, a name, and an optional span. */
interface Row {
  id: string;
  name: string;
  start: number | null;
  end: number | null;
}

const DAY = 86_400_000;
const catalog: TimelineCatalog<Row> = {
  id: (row) => row.id,
  label: (row) => row.name,
  sublabel: () => null,
  href: (row) => `/rows/${row.id}`,
  span: (row) => resolveSpan(row.start, row.end),
  markers: () => [],
  tint: () => 'neutral',
  progress: () => null,
  edges: () => ({ blockedBy: [], blocks: [] }),
  statusLabel: () => 'Active',
  dragSource: () => null,
};

const row = (id: string, start: number | null, end: number | null): Row => ({
  id,
  name: `Row ${id}`,
  start,
  end,
});

const flat = (rows: readonly Row[]): AppliedView<Row> => ({ rows, groups: null });
const comfortable: ViewDisplayState = DEFAULT_VIEW_DISPLAY;
const compact: ViewDisplayState = { ...DEFAULT_VIEW_DISPLAY, density: 'compact' };

describe('resolveSpan', () => {
  it('returns null only when both endpoints are absent', () => {
    expect(resolveSpan(null, null)).toBeNull();
  });

  it('anchors a single-date row to that instant instead of treating it as unscheduled', () => {
    const span = resolveSpan(5 * DAY, null);
    expect(span).toEqual({ start: 5 * DAY, end: 5 * DAY });
    expect(isAnchor(span!)).toBe(true);
  });

  it('order-normalizes so a target before a start still yields a drawable span', () => {
    expect(resolveSpan(9 * DAY, 2 * DAY)).toEqual({ start: 2 * DAY, end: 9 * DAY });
  });
});

describe('geometry', () => {
  it('derives row height from display options alone, uniformly', () => {
    expect(rowHeightFor(comfortable)).toBeGreaterThan(rowHeightFor(compact));
  });

  it('keeps bar height independent of row density', () => {
    // The decoupling made visible: the track tightens, the bar does not.
    expect(barInsetFor(comfortable)).toBeGreaterThan(barInsetFor(compact));
    expect(BAR_HEIGHT).toBe(BAR_HEIGHT);
    expect(barInsetFor(comfortable) * 2 + BAR_HEIGHT).toBe(rowHeightFor(comfortable));
    expect(barInsetFor(compact) * 2 + BAR_HEIGHT).toBe(rowHeightFor(compact));
  });

  it('never lets the pointer target spill outside its own row', () => {
    expect(hitHeightFor(comfortable)).toBeLessThanOrEqual(rowHeightFor(comfortable));
    expect(hitHeightFor(compact)).toBeLessThanOrEqual(rowHeightFor(compact));
  });

  it('grows the pointer target beyond the drawn bar', () => {
    expect(hitHeightFor(comfortable)).toBeGreaterThan(BAR_HEIGHT);
  });
});

describe('buildTimelineLayout', () => {
  it('gives every row track an identical height', () => {
    const layout = buildTimelineLayout(
      flat([row('a', 0, DAY), row('b', 2 * DAY, 9 * DAY), row('c', DAY, DAY)]),
      catalog,
      comfortable,
    );
    const heights = new Set(layout.tracks.map((track) => track.height));
    expect(heights.size).toBe(1);
    expect([...heights][0]).toBe(rowHeightFor(comfortable));
  });

  it('changes every row height together when density changes', () => {
    const rows = [row('a', 0, DAY), row('b', DAY, 2 * DAY)];
    const tight = buildTimelineLayout(flat(rows), catalog, compact);
    expect(new Set(tight.tracks.map((track) => track.height)).size).toBe(1);
    expect(tight.height).toBeLessThan(buildTimelineLayout(flat(rows), catalog, comfortable).height);
  });

  it('stacks tracks contiguously so offsets are pure arithmetic', () => {
    const layout = buildTimelineLayout(
      flat([row('a', 0, DAY), row('b', DAY, 2 * DAY), row('c', 0, DAY)]),
      catalog,
      comfortable,
    );
    let expected = 0;
    for (const track of layout.tracks) {
      expect(track.top).toBe(expected);
      expected += track.height;
    }
    expect(layout.height).toBe(expected);
  });

  it('partitions undated rows into the tray instead of plotting them', () => {
    const layout = buildTimelineLayout(
      flat([row('dated', 0, DAY), row('undated', null, null)]),
      catalog,
      comfortable,
    );
    expect(layout.unscheduled.map((entry) => entry.id)).toEqual(['undated']);
    expect(layout.placed.map((entry) => entry.id)).toEqual(['dated']);
    expect(layout.tracks).toHaveLength(1);
  });

  it('renders a band header per group rather than flattening the groups away', () => {
    const applied: AppliedView<Row> = {
      rows: [row('a', 0, DAY), row('b', DAY, 2 * DAY)],
      groups: [
        { id: 'team-1', label: 'Platform', rows: [row('a', 0, DAY)] },
        { id: 'team-2', label: 'Growth', rows: [row('b', DAY, 2 * DAY)] },
      ],
    };
    const layout = buildTimelineLayout(applied, catalog, comfortable);
    const groups = layout.tracks.filter((track) => track.kind === 'group');
    expect(groups.map((track) => track.label)).toEqual(['Platform', 'Growth']);
    expect(layout.tracks.map((track) => track.kind)).toEqual(['group', 'row', 'group', 'row']);
  });

  it('counts only the plotted rows on a band header', () => {
    const applied: AppliedView<Row> = {
      rows: [],
      groups: [
        {
          id: 'g',
          label: 'Mixed',
          rows: [row('a', 0, DAY), row('undated', null, null)],
        },
      ],
    };
    const layout = buildTimelineLayout(applied, catalog, comfortable);
    const header = layout.tracks[0];
    if (header?.kind !== 'group') throw new Error('expected a group band header first');
    expect(header.count).toBe(1);
    expect(layout.unscheduled).toHaveLength(1);
  });

  it('exposes a routing center per placed row for the dependency layer', () => {
    const layout = buildTimelineLayout(
      flat([row('a', 0, DAY), row('b', DAY, 2 * DAY)]),
      catalog,
      comfortable,
    );
    const height = rowHeightFor(comfortable);
    expect(layout.centerById.get('a')).toBe(height / 2);
    expect(layout.centerById.get('b')).toBe(height + height / 2);
  });
});
