'use client';

import { useState, useCallback, type RefObject } from 'react';
import { MIN_HOUR_HEIGHT, BASE_HOUR_HEIGHT, MAX_ZOOM, MIN_ZOOM } from '@/lib/calendar-utils';
import type { CalendarScrollMode } from '../types';

export interface UseCalendarZoomOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  containerHeight: number;
  numberOfHours: number;
  scrollMode: CalendarScrollMode;
}

export interface UseCalendarZoomReturn {
  zoom: number;
  hourHeight: number;
  baseHourHeight: number;
  zoomIn: () => void;
  zoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/**
 * Encapsulates zoom state and center-preserving zoom behavior.
 */
export function useCalendarZoom({
  scrollRef,
  containerHeight,
  numberOfHours,
  scrollMode,
}: UseCalendarZoomOptions): UseCalendarZoomReturn {
  const [zoom, setZoom] = useState(1);

  // Calculate hourHeight based on mode
  const baseHourHeight = containerHeight > 0 ? containerHeight / numberOfHours : BASE_HOUR_HEIGHT;
  const hourHeight =
    scrollMode === 'fit'
      ? Math.max(baseHourHeight * zoom, MIN_HOUR_HEIGHT)
      : Math.max(BASE_HOUR_HEIGHT * zoom, MIN_HOUR_HEIGHT);

  // Zoom in with center preservation
  const zoomIn = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      setZoom((z) => Math.min(z + 1, MAX_ZOOM));
      return;
    }

    const centerY = container.scrollTop + container.clientHeight / 2;
    const centerRatio = centerY / (numberOfHours * hourHeight);

    setZoom((z) => {
      const newZoom = Math.min(z + 1, MAX_ZOOM);
      // Schedule scroll adjustment after render
      requestAnimationFrame(() => {
        const newHourHeight =
          scrollMode === 'fit'
            ? Math.max(baseHourHeight * newZoom, MIN_HOUR_HEIGHT)
            : Math.max(BASE_HOUR_HEIGHT * newZoom, MIN_HOUR_HEIGHT);
        const newCenterY = centerRatio * numberOfHours * newHourHeight;
        container.scrollTop = newCenterY - container.clientHeight / 2;
      });
      return newZoom;
    });
  }, [numberOfHours, hourHeight, scrollMode, baseHourHeight, scrollRef]);

  // Zoom out with center preservation
  const zoomOut = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      setZoom((z) => Math.max(z - 1, MIN_ZOOM));
      return;
    }

    const centerY = container.scrollTop + container.clientHeight / 2;
    const centerRatio = centerY / (numberOfHours * hourHeight);

    setZoom((z) => {
      const newZoom = Math.max(z - 1, MIN_ZOOM);
      // Schedule scroll adjustment after render
      requestAnimationFrame(() => {
        const newHourHeight =
          scrollMode === 'fit'
            ? Math.max(baseHourHeight * newZoom, MIN_HOUR_HEIGHT)
            : Math.max(BASE_HOUR_HEIGHT * newZoom, MIN_HOUR_HEIGHT);
        const newCenterY = centerRatio * numberOfHours * newHourHeight;
        container.scrollTop = newCenterY - container.clientHeight / 2;
      });
      return newZoom;
    });
  }, [numberOfHours, hourHeight, scrollMode, baseHourHeight, scrollRef]);

  return {
    zoom,
    hourHeight,
    baseHourHeight,
    zoomIn,
    zoomOut,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
  };
}
