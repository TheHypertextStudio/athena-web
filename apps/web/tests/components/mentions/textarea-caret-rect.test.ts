import { describe, expect, it } from 'vitest';

import { caretRectFrom, type Rect } from '@/components/mentions/textarea-caret-rect';

const field: Rect = { left: 100, top: 200, width: 300, height: 80 };

describe('caretRectFrom', () => {
  it('places the caret relative to the field it lives in', () => {
    expect(
      caretRectFrom({
        marker: { left: 40, top: 18, width: 1, height: 16 },
        element: field,
        scrollTop: 0,
        scrollLeft: 0,
      }),
    ).toEqual({ left: 140, top: 218, width: 1, height: 16 });
  });

  it('subtracts the field’s scroll, so a long note anchors where the caret actually is', () => {
    expect(
      caretRectFrom({
        marker: { left: 40, top: 500, width: 1, height: 16 },
        element: field,
        scrollTop: 460,
        scrollLeft: 0,
      }),
    ).toMatchObject({ top: 240 });
  });

  it('clamps a caret scrolled above the field to its top edge', () => {
    // Without clamping the menu would anchor off the field entirely, beside unrelated content.
    expect(
      caretRectFrom({
        marker: { left: 40, top: 10, width: 1, height: 16 },
        element: field,
        scrollTop: 400,
        scrollLeft: 0,
      }),
    ).toMatchObject({ top: 200 });
  });

  it('clamps a caret scrolled below the field to its bottom edge', () => {
    expect(
      caretRectFrom({
        marker: { left: 40, top: 900, width: 1, height: 16 },
        element: field,
        scrollTop: 0,
        scrollLeft: 0,
      }),
    ).toMatchObject({ top: 280 });
  });

  it('clamps horizontally at both edges', () => {
    expect(
      caretRectFrom({
        marker: { left: 900, top: 10, width: 1, height: 16 },
        element: field,
        scrollTop: 0,
        scrollLeft: 0,
      }),
    ).toMatchObject({ left: 400 });

    expect(
      caretRectFrom({
        marker: { left: 10, top: 10, width: 1, height: 16 },
        element: field,
        scrollTop: 0,
        scrollLeft: 900,
      }),
    ).toMatchObject({ left: 100 });
  });

  it('keeps the marker’s own size, which is what gives the menu a line to sit under', () => {
    expect(
      caretRectFrom({
        marker: { left: 0, top: 0, width: 2, height: 24 },
        element: field,
        scrollTop: 0,
        scrollLeft: 0,
      }),
    ).toMatchObject({ width: 2, height: 24 });
  });
});
