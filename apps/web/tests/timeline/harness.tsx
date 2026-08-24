/**
 * `tests/timeline` — the shared fixture the timeline's rendered-geometry tests are built on.
 *
 * @remarks
 * Every assertion in this directory is about what the canvas *renders*, so the fixture is a real
 * `TimelineCanvas` over a real catalog rather than a hand-built DOM. Two things jsdom does not
 * provide have to be supplied for that to mean anything:
 *
 * - **A layout.** `getBoundingClientRect` returns all zeros, and the drag hook (correctly) refuses
 *   to open a gesture on a zero-width plot, because a zero-width plot has no pixels-to-dates
 *   ratio. {@link stubLayout} gives the plot area a stable box so a scripted pointer drag exercises
 *   the same code path a real one does.
 * - **Animation frames.** The edge-zone auto-scroller is driven by `requestAnimationFrame`.
 *   {@link controlFrames} makes them explicit so a test can step the loop and assert on what one
 *   frame actually did, instead of waiting on a timer.
 */
import type { JSX } from 'react';

import type { TimelineCatalog, TimelineSpan } from '@/components/timeline/timeline-catalog';
import { resolveSpan } from '@/components/timeline/timeline-catalog';
import TimelineCanvas from '@/components/timeline/timeline-canvas';
import type { AppliedView } from '@/components/views/apply-view';
import {
  DEFAULT_VIEW_DISPLAY,
  type ViewDisplayState,
  type ViewScale,
} from '@/components/views/field-catalog';
import { buildScale, type TimeWindow } from '@/components/timeline/time-scale';
import type { TimelineViewport } from '@/components/timeline/use-timeline-viewport';

/**
 * jsdom ships no `ResizeObserver`, and the dependency-edge layer measures the plot with one.
 *
 * @remarks
 * Installed as a no-op rather than mocked per test: the edge layer's own behaviour (it renders
 * nothing until it has a width) is correct under a silent observer, and nothing in this directory
 * asserts on edge routing.
 */
if (!('ResizeObserver' in globalThis)) {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {
      /* jsdom performs no layout, so there is nothing to report. */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  globalThis.ResizeObserver = NoopResizeObserver;
}

/**
 * jsdom implements no pointer capture, which every timeline drag opens with.
 *
 * @remarks
 * Capture is what keeps a fast drag tracking after the pointer leaves the bar, so removing the
 * call to make tests pass would be testing a different gesture. A recording stub keeps the real
 * code path and lets the release path's `hasPointerCapture` guard behave.
 */
if (typeof Element.prototype.setPointerCapture !== 'function') {
  const captured = new WeakMap<Element, Set<number>>();
  Element.prototype.setPointerCapture = function setPointerCapture(pointerId: number): void {
    const ids = captured.get(this) ?? new Set<number>();
    ids.add(pointerId);
    captured.set(this, ids);
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture(
    pointerId: number,
  ): void {
    captured.get(this)?.delete(pointerId);
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId: number): boolean {
    return captured.get(this)?.has(pointerId) ?? false;
  };
}

/** One day in milliseconds. */
export const DAY = 86_400_000;
/** A fixed instant every fixture date is expressed relative to (2026-03-01T00:00:00Z). */
export const EPOCH = Date.UTC(2026, 2, 1);

/** A fixture row: an id, a name, and an optional date pair. */
export interface Row {
  /** Stable id. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Start offset in days from {@link EPOCH}, or `null` when undated. */
  readonly start: number | null;
  /** End offset in days from {@link EPOCH}, or `null`. */
  readonly end: number | null;
  /** Ids this row blocks. */
  readonly blocks?: readonly string[];
}

/** Build a fixture row. */
export function row(
  id: string,
  start: number | null,
  end: number | null,
  blocks: readonly string[] = [],
): Row {
  return { id, name: `Project ${id}`, start, end, blocks };
}

/** The fixture catalog — the smallest honest projection of {@link Row} onto a time axis. */
export const catalog: TimelineCatalog<Row> = {
  id: (r) => r.id,
  label: (r) => r.name,
  sublabel: () => null,
  href: (r) => `/rows/${r.id}`,
  span: (r): TimelineSpan | null =>
    resolveSpan(
      r.start === null ? null : EPOCH + r.start * DAY,
      r.end === null ? null : EPOCH + r.end * DAY,
    ),
  markers: () => [],
  tint: () => 'neutral',
  progress: () => null,
  edges: (r) => ({ blockedBy: [], blocks: r.blocks ?? [] }),
  statusLabel: () => 'Planned',
  object: () => null,
};

/** An ungrouped applied view over the given rows. */
export function flat(rows: readonly Row[]): AppliedView<Row> {
  return { rows: [...rows], groups: null };
}

/** A viewport fixed to a known window, so projected offsets are deterministic. */
export function fixedViewport(window: TimeWindow, scale: ViewScale = 'auto'): TimelineViewport {
  return {
    window,
    scale: buildScale(window, scale),
    setWindow: () => undefined,
    resetToToday: () => undefined,
    zoomIn: () => undefined,
    zoomOut: () => undefined,
    panEarlier: () => undefined,
    panLater: () => undefined,
  };
}

/** Props for {@link Fixture}. */
export interface FixtureProps {
  /** The rows to plot. */
  readonly rows: readonly Row[];
  /** The presentation toggles; defaults to the app default. */
  readonly display?: ViewDisplayState;
  /** The viewport; defaults to a 120-day window opening at {@link EPOCH}. */
  readonly viewport?: TimelineViewport;
  /** Whether the viewer may reschedule. */
  readonly canSchedule?: boolean;
  /** Commit handler, so a drag test can assert what was persisted. */
  readonly onReschedule?: (id: string, span: TimelineSpan) => void;
}

/** The default fixture window: 120 days opening at {@link EPOCH}. */
export const DEFAULT_WINDOW: TimeWindow = { min: EPOCH, max: EPOCH + 120 * DAY };

/** Render the timeline canvas over fixture rows. */
export function Fixture({
  rows,
  display = DEFAULT_VIEW_DISPLAY,
  viewport,
  canSchedule = true,
  onReschedule = () => undefined,
}: FixtureProps): JSX.Element {
  return (
    <TimelineCanvas
      applied={flat(rows)}
      catalog={catalog}
      display={display}
      viewport={viewport ?? fixedViewport(DEFAULT_WINDOW)}
      noun="Project"
      pluralNoun="Projects"
      canSchedule={canSchedule}
      fullBleed
      onReschedule={onReschedule}
      onApplyCascade={() => undefined}
      applyingCascade={false}
      onActivate={() => undefined}
      onPrefetch={() => undefined}
    />
  );
}

/** A rectangle for {@link stubLayout}. */
export interface StubBox {
  /** Left edge in viewport pixels. */
  readonly left: number;
  /** Top edge in viewport pixels. */
  readonly top: number;
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
}

/**
 * Give every element a fixed box, so pointer-to-date projection is exercised for real.
 *
 * @param box - The box every element reports.
 * @returns a restore function.
 */
export function stubLayout(box: StubBox): () => void {
  const original = Element.prototype.getBoundingClientRect.bind(Element.prototype);
  const rect: DOMRect = {
    x: box.left,
    y: box.top,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => ({}),
  };
  // An arrow function so the replacement never depends on `this` — it reports the same box for
  // every element, which is all a layout-free environment can honestly offer.
  Element.prototype.getBoundingClientRect = (): DOMRect => rect;
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** Manual control over `requestAnimationFrame`, for stepping the auto-scroll loop. */
export interface FrameControl {
  /** Run every frame currently queued (one tick of the loop). */
  readonly step: () => void;
  /** How many frames are queued. */
  readonly pending: () => number;
  /** Restore the real implementations. */
  readonly restore: () => void;
}

/**
 * Replace `requestAnimationFrame` with a queue a test drives by hand.
 *
 * @returns the {@link FrameControl}.
 */
export function controlFrames(): FrameControl {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };

  return {
    step: () => {
      const due = [...queue.entries()];
      queue.clear();
      for (const [, callback] of due) callback(performance.now());
    },
    pending: () => queue.size,
    restore: () => {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}
