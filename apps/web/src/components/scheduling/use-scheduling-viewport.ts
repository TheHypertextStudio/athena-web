'use client';

import {
  type RefObject,
  type UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  deriveLaneGeometry,
  minutesToPixels,
  type ScheduleLaneGeometry,
} from './scheduling-geometry';
import { SchedulingHorizontalBoundary } from './scheduling-horizontal-boundary';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import { visibleScheduleLaneRange } from './scheduling-visible-lanes';

const HOUR_GUTTER_WIDTH = 64;

interface UseSchedulingViewportOptions {
  readonly lanes: readonly ScheduleLane[];
  readonly pixelsPerHour: number;
  readonly viewportWidth?: number;
  readonly minimumLaneWidth: number;
  readonly initialLaneIndex: number;
  readonly horizontalAnchorKey?: string | number;
  readonly initialScrollMinutes: number;
  readonly onViewportGeometry?: SchedulingCanvasProps['onViewportGeometry'];
  readonly onVisibleLaneRange?: SchedulingCanvasProps['onVisibleLaneRange'];
  readonly onReachBoundary?: SchedulingCanvasProps['onReachBoundary'];
}

interface SchedulingViewportController {
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  readonly timedGridRef: RefObject<HTMLDivElement | null>;
  readonly observedWidth: number;
  readonly geometry: ScheduleLaneGeometry;
  readonly onScroll: (event: ReactUIEvent<HTMLElement>) => void;
}

/** Own fluid lane measurement, scroll retention, zoom centering, and boundary reporting. */
export function useSchedulingViewport({
  lanes,
  pixelsPerHour,
  viewportWidth,
  minimumLaneWidth,
  initialLaneIndex,
  horizontalAnchorKey,
  initialScrollMinutes,
  onViewportGeometry,
  onVisibleLaneRange,
  onReachBoundary,
}: UseSchedulingViewportOptions): SchedulingViewportController {
  const viewportRef = useRef<HTMLDivElement>(null);
  const timedGridRef = useRef<HTMLDivElement>(null);
  const initializedWindowRef = useRef<
    | {
        readonly firstLaneId: string | undefined;
        readonly horizontalAnchorKey: string | number | undefined;
      }
    | undefined
  >(undefined);
  const initializedVerticalScrollRef = useRef(false);
  const previousPixelsPerHourRef = useRef(pixelsPerHour);
  const viewportCenterMinutesRef = useRef<number | undefined>(undefined);
  const visibleLaneRangeKeyRef = useRef<string | undefined>(undefined);
  const horizontalBoundaryRef = useRef(new SchedulingHorizontalBoundary());
  // Zero represents an unmeasured container. Assuming a desktop width here would briefly report
  // phantom lanes and could make a responsive correction look like horizontal navigation.
  const [observedWidth, setObservedWidth] = useState(0);

  useLayoutEffect(() => {
    if (viewportWidth !== undefined) return;
    const element = viewportRef.current;
    if (!element) return;
    const update = (): void => {
      horizontalBoundaryRef.current.synchronize(element);
      if (element.clientWidth > 0) setObservedWidth(element.clientWidth);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return observer.disconnect.bind(observer);
  }, [viewportWidth]);

  const geometry = useMemo(
    () =>
      deriveLaneGeometry({
        viewportWidth: viewportWidth ?? observedWidth,
        laneCount: lanes.length,
        gutterWidth: HOUR_GUTTER_WIDTH,
        minimumLaneWidth,
      }),
    [lanes.length, minimumLaneWidth, observedWidth, viewportWidth],
  );
  const hasMeasuredViewport = viewportWidth !== undefined || observedWidth > 0;

  const reportVisibleLaneRange = useCallback(
    (viewport: HTMLElement): void => {
      if (!onVisibleLaneRange) return;
      const range = visibleScheduleLaneRange({
        viewport,
        lanes,
        laneWidth: geometry.laneWidth,
        gutterWidth: geometry.gutterWidth,
        fallbackWidth: viewportWidth ?? observedWidth,
      });
      if (!range) return;
      const { startLane, endLane } = range;
      const key = `${startLane.id}:${endLane.id}`;
      if (visibleLaneRangeKeyRef.current === key) return;
      visibleLaneRangeKeyRef.current = key;
      onVisibleLaneRange({ startLane, endLane });
    },
    [
      geometry.gutterWidth,
      geometry.laneWidth,
      lanes,
      observedWidth,
      onVisibleLaneRange,
      viewportWidth,
    ],
  );

  useEffect(() => {
    if (!hasMeasuredViewport) return;
    onViewportGeometry?.({
      visibleLaneCount: geometry.visibleLaneCount,
      laneWidth: geometry.laneWidth,
    });
  }, [geometry.laneWidth, geometry.visibleLaneCount, hasMeasuredViewport, onViewportGeometry]);

  useLayoutEffect(() => {
    if (!hasMeasuredViewport) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const timedGridOffset = timedGridRef.current?.offsetTop ?? 0;
    const firstLaneId = lanes[0]?.id;
    const initializedWindow = initializedWindowRef.current;
    if (
      initializedWindow?.firstLaneId !== firstLaneId ||
      initializedWindow?.horizontalAnchorKey !== horizontalAnchorKey
    ) {
      viewport.scrollLeft = initialLaneIndex > 0 ? initialLaneIndex * geometry.laneWidth : 0;
      initializedWindowRef.current = { firstLaneId, horizontalAnchorKey };
    }
    if (!initializedVerticalScrollRef.current) {
      viewport.scrollTop = Math.max(
        0,
        timedGridOffset + minutesToPixels(initialScrollMinutes, pixelsPerHour) - 48,
      );
      initializedVerticalScrollRef.current = true;
    } else if (previousPixelsPerHourRef.current !== pixelsPerHour) {
      const previous = Math.max(1, previousPixelsPerHourRef.current);
      const centerMinutes =
        viewportCenterMinutesRef.current ??
        ((viewport.scrollTop + viewport.clientHeight / 2 - timedGridOffset) / previous) * 60;
      viewport.scrollTop = Math.max(
        0,
        timedGridOffset + minutesToPixels(centerMinutes, pixelsPerHour) - viewport.clientHeight / 2,
      );
    }
    viewportCenterMinutesRef.current =
      ((viewport.scrollTop + viewport.clientHeight / 2 - timedGridOffset) / pixelsPerHour) * 60;
    previousPixelsPerHourRef.current = pixelsPerHour;
    horizontalBoundaryRef.current.synchronize(viewport);
    reportVisibleLaneRange(viewport);
  }, [
    geometry.laneWidth,
    hasMeasuredViewport,
    horizontalAnchorKey,
    initialLaneIndex,
    initialScrollMinutes,
    lanes,
    pixelsPerHour,
    reportVisibleLaneRange,
  ]);

  return {
    viewportRef,
    timedGridRef,
    observedWidth,
    geometry,
    onScroll: (event) => {
      const viewport = event.currentTarget;
      reportVisibleLaneRange(viewport);
      const timedGridOffset = timedGridRef.current?.offsetTop ?? 0;
      viewportCenterMinutesRef.current =
        ((viewport.scrollTop + viewport.clientHeight / 2 - timedGridOffset) * 60) / pixelsPerHour;
      const direction = horizontalBoundaryRef.current.observe(viewport);
      if (direction && onReachBoundary) onReachBoundary(direction);
    },
  };
}
