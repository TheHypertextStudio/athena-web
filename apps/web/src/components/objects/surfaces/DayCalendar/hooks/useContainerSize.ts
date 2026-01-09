'use client';

import { useState, useLayoutEffect, type RefObject } from 'react';

export interface UseContainerSizeOptions {
  ref: RefObject<HTMLDivElement | null>;
}

export interface UseContainerSizeReturn {
  width: number;
  height: number;
}

/**
 * Measures container dimensions using ResizeObserver.
 * Updates when the container resizes.
 */
export function useContainerSize({ ref }: UseContainerSizeOptions): UseContainerSizeReturn {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);

    // Initial measurement
    setSize({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}
