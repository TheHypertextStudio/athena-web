'use client';

/**
 * `calendar/item-drawer/auto-grow` — a textarea that is exactly as tall as its content.
 *
 * @remarks
 * An event's title has to be editable in place and has to wrap, and an `<input>` can only do the
 * first: a long title clipped mid-word at the panel edge, unreadable. A textarea wraps but
 * reserves a fixed row count, which leaves dead space under short notes. Measuring is the only way
 * to get both, and it has to run on layout rather than in an effect so the first paint is already
 * the right height.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Keep a textarea sized to its own content.
 *
 * @param value - The current value, so a programmatic change resizes too.
 * @returns the ref to place on the textarea.
 */
export function useAutoGrow(value: string): (node: HTMLTextAreaElement | null) => void {
  const nodeRef = useRef<HTMLTextAreaElement | null>(null);

  const measure = useCallback((): void => {
    const node = nodeRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${String(node.scrollHeight)}px`;
  }, []);

  useLayoutEffect(measure, [measure, value]);

  return useCallback(
    (node: HTMLTextAreaElement | null): void => {
      nodeRef.current = node;
      measure();
    },
    [measure],
  );
}
