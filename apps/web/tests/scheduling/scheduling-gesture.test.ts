import { describe, expect, it } from 'vitest';

import {
  deriveGesturePreview,
  type DeriveGesturePreviewOptions,
} from '@/components/scheduling/scheduling-gesture';

const EDITABLE_LANES = [
  { id: 'ada', editable: true },
  { id: 'grace', editable: true },
  { id: 'linus', editable: true },
] as const;

/** Build one complete gesture fixture while allowing focused contract overrides. */
function gesture(
  overrides: Partial<DeriveGesturePreviewOptions> = {},
): DeriveGesturePreviewOptions {
  return {
    mode: 'move',
    original: { laneIndex: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 },
    delta: { x: 0, y: 0 },
    laneGeometry: {
      laneWidth: 200,
      gutterWidth: 64,
      viewportWidth: 664,
      originViewportX: 114,
      originContentX: 50,
      scrollDelta: { x: 0, y: 0 },
    },
    pixelsPerHour: 60,
    snapMinutes: 15,
    itemEditable: true,
    lanes: EDITABLE_LANES,
    ...overrides,
  };
}

describe('deriveGesturePreview', () => {
  it('moves within the source lane using the exact active snap', () => {
    expect(deriveGesturePreview(gesture({ delta: { x: 0, y: 23 } }))).toEqual({
      laneIndex: 0,
      startMinutes: 9 * 60 + 30,
      endMinutes: 10 * 60 + 30,
    });
  });

  it('moves across arbitrary lane geometry while preserving duration', () => {
    expect(deriveGesturePreview(gesture({ delta: { x: 200, y: -16 } }))).toEqual({
      laneIndex: 1,
      startMinutes: 9 * 60 - 15,
      endMinutes: 10 * 60 - 15,
    });
  });

  it('refuses item, source-lane, and target-lane policies that are read-only', () => {
    expect(deriveGesturePreview(gesture({ itemEditable: false }))).toBeNull();
    expect(
      deriveGesturePreview(
        gesture({ lanes: [{ id: 'ada', editable: false }, ...EDITABLE_LANES.slice(1)] }),
      ),
    ).toBeNull();
    expect(
      deriveGesturePreview(
        gesture({
          delta: { x: 200, y: 0 },
          lanes: [EDITABLE_LANES[0], { id: 'grace', editable: false }, EDITABLE_LANES[2]],
        }),
      ),
    ).toBeNull();
  });

  it('clamps a move to both day boundaries without changing its duration', () => {
    expect(
      deriveGesturePreview(
        gesture({
          original: { laneIndex: 0, startMinutes: 30, endMinutes: 90 },
          delta: { x: 0, y: -120 },
        }),
      ),
    ).toEqual({ laneIndex: 0, startMinutes: 0, endMinutes: 60 });
    expect(
      deriveGesturePreview(
        gesture({
          original: { laneIndex: 0, startMinutes: 23 * 60, endMinutes: 24 * 60 },
          delta: { x: 0, y: 120 },
        }),
      ),
    ).toEqual({ laneIndex: 0, startMinutes: 23 * 60, endMinutes: 24 * 60 });
  });

  it('slides a clipped overnight start segment later without pinning its start', () => {
    expect(
      deriveGesturePreview(
        gesture({
          original: { laneIndex: 0, startMinutes: 23 * 60 + 30, endMinutes: 24 * 60 },
          delta: { x: 0, y: 15 },
        }),
      ),
    ).toEqual({ laneIndex: 0, startMinutes: 23 * 60 + 45, endMinutes: 24 * 60 });
  });

  it('resizes the start edge and enforces the day and post-movement minimum', () => {
    expect(deriveGesturePreview(gesture({ mode: 'resize-start', delta: { x: 0, y: 30 } }))).toEqual(
      { laneIndex: 0, startMinutes: 9 * 60 + 30, endMinutes: 10 * 60 },
    );
    expect(
      deriveGesturePreview(
        gesture({
          mode: 'resize-start',
          original: { laneIndex: 0, startMinutes: 15, endMinutes: 75 },
          delta: { x: 0, y: -120 },
        }),
      ),
    ).toEqual({ laneIndex: 0, startMinutes: 0, endMinutes: 75 });
  });

  it('resizes the end edge and enforces the post-movement minimum', () => {
    expect(deriveGesturePreview(gesture({ mode: 'resize-end', delta: { x: 0, y: 30 } }))).toEqual({
      laneIndex: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60 + 30,
    });
    expect(
      deriveGesturePreview(
        gesture({
          mode: 'resize-end',
          original: { laneIndex: 0, startMinutes: 23 * 60, endMinutes: 23 * 60 + 30 },
          delta: { x: 0, y: 120 },
        }),
      ),
    ).toEqual({ laneIndex: 0, startMinutes: 23 * 60, endMinutes: 25 * 60 + 30 });
  });

  it('lets the true end edge cross midnight', () => {
    expect(
      deriveGesturePreview(
        gesture({
          mode: 'resize-end',
          original: { laneIndex: 0, startMinutes: 23 * 60, endMinutes: 23 * 60 + 30 },
          delta: { x: 0, y: 60 },
        }),
      ),
    ).toEqual({ laneIndex: 0, startMinutes: 23 * 60, endMinutes: 24 * 60 + 30 });
  });

  it('rounds at the exact half-snap threshold', () => {
    expect(deriveGesturePreview(gesture({ delta: { x: 0, y: 7.49 } }))).toEqual({
      laneIndex: 0,
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
    });
    expect(deriveGesturePreview(gesture({ delta: { x: 0, y: 7.5 } }))).toEqual({
      laneIndex: 0,
      startMinutes: 9 * 60 + 15,
      endMinutes: 10 * 60 + 15,
    });
    expect(deriveGesturePreview(gesture({ delta: { x: 0, y: -7.5 } }))).toEqual({
      laneIndex: 0,
      startMinutes: 9 * 60 - 15,
      endMinutes: 10 * 60 - 15,
    });
  });

  it('rejects the sticky gutter, viewport exterior, and content exterior instead of clamping', () => {
    expect(deriveGesturePreview(gesture({ delta: { x: -51, y: 0 } }))).toBeNull();
    expect(deriveGesturePreview(gesture({ delta: { x: 551, y: 0 } }))).toBeNull();
    expect(
      deriveGesturePreview(
        gesture({
          delta: { x: 200, y: 0 },
          laneGeometry: {
            ...gesture().laneGeometry,
            originContentX: 450,
            scrollDelta: { x: 0, y: 0 },
          },
        }),
      ),
    ).toBeNull();
  });

  it('includes viewport scrolling in both target-lane and vertical preview geometry', () => {
    expect(
      deriveGesturePreview(
        gesture({
          delta: { x: 0, y: 0 },
          laneGeometry: {
            ...gesture().laneGeometry,
            scrollDelta: { x: 200, y: 15 },
          },
        }),
      ),
    ).toEqual({ laneIndex: 1, startMinutes: 9 * 60 + 15, endMinutes: 10 * 60 + 15 });
  });

  it('ignores horizontal lane changes while resizing either edge', () => {
    expect(
      deriveGesturePreview(gesture({ mode: 'resize-start', delta: { x: 200, y: -15 } })),
    ).toEqual({ laneIndex: 0, startMinutes: 9 * 60 - 15, endMinutes: 10 * 60 });
    expect(deriveGesturePreview(gesture({ mode: 'resize-end', delta: { x: 200, y: 15 } }))).toEqual(
      { laneIndex: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 + 15 },
    );
  });

  it.each(['resize-start', 'resize-end'] as const)(
    'keeps a five-minute item unchanged for a zero-delta %s at overview zoom',
    (mode) => {
      expect(
        deriveGesturePreview(
          gesture({
            mode,
            original: { laneIndex: 0, startMinutes: 9 * 60, endMinutes: 9 * 60 + 5 },
            pixelsPerHour: 24,
            snapMinutes: 60,
          }),
        ),
      ).toEqual({ laneIndex: 0, startMinutes: 9 * 60, endMinutes: 9 * 60 + 5 });
    },
  );
});
