import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCanvasFloatingChrome } from '../../../src/components/canvas/canvas-floating-chrome';
import { CANVAS_OVERLAY_GUTTER } from '../../../src/components/canvas/canvas-viewport-insets';

describe('useCanvasFloatingChrome', () => {
  it('covers nothing when the host floats no chrome', () => {
    const { result } = renderHook(() => useCanvasFloatingChrome(false));

    expect(result.current.compact).toBe(false);
    expect(result.current.chromed).toBe(false);
    expect(result.current.insets).toBeUndefined();
    expect(result.current.noticeClass).toBeUndefined();
  });

  it('counts a band as chrome without floating it', () => {
    const { result } = renderHook(() => useCanvasFloatingChrome(false, true));

    expect(result.current.chromed).toBe(true);
    expect(result.current.compact).toBe(false);
    expect(result.current.insets).toBeUndefined();
  });

  it('frames the canvas below the measured bar', () => {
    const { result } = renderHook(() => useCanvasFloatingChrome(true));

    act(() => {
      result.current.onHeightChange(44);
    });

    expect(result.current.compact).toBe(true);
    expect(result.current.insets).toEqual({ top: 44 + CANVAS_OVERLAY_GUTTER });
  });

  it('adds the right edge a floating inspector covers, and drops it when the inspector closes', () => {
    const { result } = renderHook(() => useCanvasFloatingChrome(true));

    act(() => {
      result.current.onHeightChange(44);
      result.current.onInspectorOcclusion(328);
    });
    expect(result.current.inspectorRight).toBe(328);
    expect(result.current.insets).toEqual({ top: 44 + CANVAS_OVERLAY_GUTTER, right: 328 });

    act(() => {
      result.current.onInspectorOcclusion(0);
    });
    expect(result.current.insets).toEqual({ top: 44 + CANVAS_OVERLAY_GUTTER });
  });

  it('keeps the same insets object while nothing changed', () => {
    const { result, rerender } = renderHook(() => useCanvasFloatingChrome(true));
    const first = result.current.insets;

    rerender();

    expect(result.current.insets).toBe(first);
  });
});
