import { describe, expect, it } from 'vitest';

import { computeFirstFrameViewport } from '@/components/canvas/graph-first-frame-viewport';

const PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

describe('computeFirstFrameViewport', () => {
  it('centres the graph in the clear area', () => {
    const frame = computeFirstFrameViewport({
      bounds: { x: 10, y: 20, width: 400, height: 200 },
      viewport: { width: 1000, height: 600 },
      padding: PADDING,
      zoom: 1,
      anchor: 'center',
    });
    // Clear area is 952 x 552; spare is 552 x 352; half of each, minus the bounds origin.
    expect(frame).toEqual({ x: 24 + 276 - 10, y: 24 + 176 - 20, zoom: 1 });
  });

  it('anchors the graph to the left edge and keeps it vertically centred', () => {
    const frame = computeFirstFrameViewport({
      bounds: { x: 10, y: 20, width: 400, height: 200 },
      viewport: { width: 1000, height: 600 },
      padding: { ...PADDING, right: 324 },
      zoom: 0.5,
      anchor: 'start',
    });
    expect(frame.x).toBe(24 - 10 * 0.5);
    // Clear height 552, graph 100 tall at half zoom: spare 452, half is 226.
    expect(frame.y).toBe(24 + 226 - 20 * 0.5);
    expect(frame.zoom).toBe(0.5);
  });

  it('never pushes the graph past the padding when it is larger than the clear area', () => {
    const frame = computeFirstFrameViewport({
      bounds: { x: 0, y: 0, width: 2000, height: 2000 },
      viewport: { width: 800, height: 600 },
      padding: PADDING,
      zoom: 1,
      anchor: 'center',
    });
    expect(frame).toEqual({ x: 24, y: 24, zoom: 1 });
  });
});
