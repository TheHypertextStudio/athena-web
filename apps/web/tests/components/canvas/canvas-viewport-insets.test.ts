import { describe, expect, it } from 'vitest';

import {
  availableCanvasHeight,
  availableCanvasWidth,
  CANVAS_OVERLAY_GUTTER,
  fitPaddingFor,
  occludedRight,
} from '@/components/canvas/canvas-viewport-insets';

describe('canvas viewport insets', () => {
  it('pads the base gutter on every side and adds what chrome covers on top and right', () => {
    expect(fitPaddingFor()).toEqual({ top: '24px', right: '24px', bottom: '24px', left: '24px' });
    expect(fitPaddingFor({ top: 56, right: 300 }, 24)).toEqual({
      top: '80px',
      right: '324px',
      bottom: '24px',
      left: '24px',
    });
  });

  it('subtracts the covered edges from the available area, never below one pixel', () => {
    expect(availableCanvasWidth(1000, { right: 300 })).toBe(652);
    expect(availableCanvasHeight(600, { top: 56 })).toBe(496);
    expect(availableCanvasWidth(100, { right: 300 })).toBe(1);
  });

  it('sums open parts with a gutter after each and ignores closed ones', () => {
    expect(occludedRight([])).toBe(0);
    expect(
      occludedRight([
        { open: true, width: 280 },
        { open: false, width: 320 },
        { open: true, width: 256 },
      ]),
    ).toBe(280 + CANVAS_OVERLAY_GUTTER + 256 + CANVAS_OVERLAY_GUTTER);
  });
});
