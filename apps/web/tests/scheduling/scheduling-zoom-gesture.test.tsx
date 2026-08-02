/**
 * Contract for the canvas's trackpad / ctrl+wheel zoom gesture.
 *
 * @remarks
 * Three things have to hold for pinch-zoom to feel like part of the app rather than the browser's:
 * an ordinary scroll must never be mistaken for zoom, a pinch must cancel the browser's own page
 * zoom, and the moment under the pointer must still be under the pointer afterwards. All three are
 * asserted here; the consumer owns clamping, so the canvas emits only a raw scale factor.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleLane } from '@/components/scheduling';

const LANE: ScheduleLane = {
  id: 'date:2026-07-13',
  label: 'Mon, Jul 13',
  date: '2026-07-13',
  items: [],
};

afterEach(cleanup);

/** Render the canvas at one zoom level with a zoom-gesture listener attached. */
function renderCanvas(
  onZoomGesture: (scale: number) => void,
  pixelsPerHour = 60,
): { rerender: (next: number) => void; viewport: HTMLElement } {
  const canvas = (zoom: number): JSX.Element => (
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[LANE]}
      pixelsPerHour={zoom}
      viewportWidth={500}
      onZoomGesture={onZoomGesture}
    />
  );
  const result = render(canvas(pixelsPerHour));
  return {
    viewport: screen.getByRole('region', { name: 'Schedule' }),
    rerender: (next) => {
      result.rerender(canvas(next));
    },
  };
}

/** Dispatch a real cancelable wheel event and report whether the canvas consumed it. */
function wheel(
  viewport: HTMLElement,
  init: { deltaY: number; ctrlKey?: boolean; metaKey?: boolean; clientY?: number },
): boolean {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: init.deltaY,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    clientY: init.clientY ?? 0,
  });
  viewport.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('SchedulingCanvas zoom gesture', () => {
  it('ignores a plain wheel so ordinary scrolling is never mistaken for zoom', () => {
    const onZoomGesture = vi.fn();
    const { viewport } = renderCanvas(onZoomGesture);

    expect(wheel(viewport, { deltaY: -180 })).toBe(false);
    expect(onZoomGesture).not.toHaveBeenCalled();
  });

  it('zooms in on a pinch and cancels the browser page zoom', () => {
    const onZoomGesture = vi.fn();
    const { viewport } = renderCanvas(onZoomGesture);

    // macOS reports a trackpad pinch as a wheel event carrying `ctrlKey`.
    expect(wheel(viewport, { deltaY: -180, ctrlKey: true })).toBe(true);
    expect(onZoomGesture).toHaveBeenCalledTimes(1);
    expect(onZoomGesture.mock.calls[0]?.[0]).toBeGreaterThan(1);
  });

  it('zooms out on the opposite pinch direction', () => {
    const onZoomGesture = vi.fn();
    const { viewport } = renderCanvas(onZoomGesture);

    wheel(viewport, { deltaY: 180, ctrlKey: true });

    expect(onZoomGesture.mock.calls[0]?.[0]).toBeLessThan(1);
  });

  it('accepts a meta+wheel zoom as well as ctrl+wheel', () => {
    const onZoomGesture = vi.fn();
    const { viewport } = renderCanvas(onZoomGesture);

    expect(wheel(viewport, { deltaY: -90, metaKey: true })).toBe(true);
    expect(onZoomGesture).toHaveBeenCalledTimes(1);
  });

  it('keeps the minute under the pointer in place across the zoom change', () => {
    const onZoomGesture = vi.fn();
    const { viewport, rerender } = renderCanvas(onZoomGesture, 60);
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    viewport.scrollTop = 100;

    // Pointer 200px down a viewport scrolled to 100px, at 60px/hour, is 05:00.
    wheel(viewport, { deltaY: -180, ctrlKey: true, clientY: 200 });
    rerender(120);

    // At 120px/hour, 05:00 sits 600px down the grid; keeping it 200px below the top means 400.
    expect(viewport.scrollTop).toBe(400);
  });

  it('falls back to preserving the viewport centre for a zoom with no pointer', () => {
    const onZoomGesture = vi.fn();
    const { viewport, rerender } = renderCanvas(onZoomGesture, 60);
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    // No wheel gesture: this is the Display menu changing zoom, which has no anchor point.
    rerender(120);

    // Centre was 300px down at 60px/hour (05:00); at 120px/hour it must stay centred.
    expect(viewport.scrollTop).toBe(400);
    expect(onZoomGesture).not.toHaveBeenCalled();
  });

  it('does not attach a wheel listener when the consumer declines zoom gestures', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(
      wheel(screen.getByRole('region', { name: 'Schedule' }), { deltaY: -180, ctrlKey: true }),
    ).toBe(false);
  });
});
