'use client';

import { useState, useEffect, type RefObject } from 'react';

export interface UseScrollStateOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
}

export interface UseScrollStateReturn {
  isScrolled: boolean;
}

/**
 * Tracks whether a scrollable container has been scrolled.
 * Useful for MD3 scroll state patterns (header elevation).
 */
export function useScrollState({ scrollRef }: UseScrollStateOptions): UseScrollStateReturn {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      setIsScrolled(container.scrollTop > 0);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [scrollRef]);

  return { isScrolled };
}
