import { describe, expect, it } from 'vitest';

import { keepNodeInViewDeltaX } from '@/components/canvas/graph-inspector-geometry';

/** A node sitting at flow x=100, 200 wide, at 1× zoom with the viewport unpanned. */
const BASE = {
  nodeX: 100,
  nodeWidth: 200,
  zoom: 1,
  viewportX: 0,
  visibleWidth: 1000,
  margin: 24,
} as const;

describe('keepNodeInViewDeltaX', () => {
  it('does not move a node that already fits', () => {
    expect(keepNodeInViewDeltaX(BASE)).toBe(0);
  });

  it('pans exactly far enough to clear the docked column, and no further', () => {
    // The column takes the canvas from 1000 to 700; the node now runs to 300 < 676, still fine.
    expect(keepNodeInViewDeltaX({ ...BASE, visibleWidth: 700 })).toBe(0);

    // Push the node right so its trailing edge lands under the column.
    const delta = keepNodeInViewDeltaX({ ...BASE, nodeX: 600, visibleWidth: 700 });
    // Right edge 800, limit 676 → the minimum move is -124, not a re-centre.
    expect(delta).toBe(-124);
  });

  it('pans a node that has fallen off the leading edge back in', () => {
    expect(keepNodeInViewDeltaX({ ...BASE, viewportX: -150 })).toBe(74);
  });

  it('aligns a node too wide to fit rather than centring it', () => {
    // 900 wide against 700 - 48 of usable width: its leading edge is the half worth keeping,
    // because that is where the title and status live.
    const delta = keepNodeInViewDeltaX({
      ...BASE,
      nodeX: 0,
      nodeWidth: 900,
      viewportX: -100,
      visibleWidth: 700,
    });
    expect(delta).toBe(124);
    expect(-100 + delta).toBe(BASE.margin);
  });

  it('scales the move with zoom', () => {
    const delta = keepNodeInViewDeltaX({ ...BASE, nodeX: 600, zoom: 0.5, visibleWidth: 700 });
    // At half zoom the node's right edge is 350, comfortably inside 676.
    expect(delta).toBe(0);
  });

  it('is a no-op for every undock — a wider canvas only ever reveals', () => {
    for (const visibleWidth of [700, 900, 1000, 1400]) {
      expect(keepNodeInViewDeltaX({ ...BASE, visibleWidth })).toBe(0);
    }
  });
});
