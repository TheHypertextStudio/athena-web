'use client';

/** Observe a canvas host and report only its coarse packing aspect. */
import { type RefCallback, useCallback, useEffect, useState } from 'react';

import { coarseGraphAspectRatio } from './graph-layout-engine';

/** A host ref and its portrait, square, or landscape layout target. */
export interface CanvasAspectRatio {
  /** Attach this to the element whose content box contains the canvas. */
  readonly containerRef: RefCallback<HTMLDivElement>;
  /** Coarse numeric target accepted by the pure layout engine. */
  readonly aspectRatio: number;
  /** Whether the host has supplied its first non-zero measurement. */
  readonly ready: boolean;
}

/** Observe the canvas host without relaying every pixel of resize churn into layout. */
export function useCanvasAspectRatio(): CanvasAspectRatio {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  const containerRef = useCallback((next: HTMLDivElement | null) => {
    setElement(next);
  }, []);
  useEffect(() => {
    if (element === null) return;
    const update = (): void => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setAspectRatio(coarseGraphAspectRatio(width / height));
        setReady(true);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return { containerRef, aspectRatio, ready };
}
