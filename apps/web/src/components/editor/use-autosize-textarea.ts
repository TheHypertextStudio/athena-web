'use client';

import { type RefObject, useEffect } from 'react';

/** Whether this browser can let CSS size a textarea directly from its wrapped content. */
function supportsNativeFieldSizing(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('field-sizing', 'content')
  );
}

/** Keep an auto-growing textarea fitted when either its value or available width changes. */
export function useAutosizeTextarea(
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    if (supportsNativeFieldSizing()) {
      field.style.height = 'auto';
      return;
    }
    field.style.height = 'auto';
    if (field.scrollHeight > 0) field.style.height = `${String(field.scrollHeight)}px`;
  }, [fieldRef, value]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field || typeof ResizeObserver === 'undefined' || supportsNativeFieldSizing()) return;

    let observedWidth = field.getBoundingClientRect().width;
    const fit = (): void => {
      field.style.height = 'auto';
      if (field.scrollHeight > 0) field.style.height = `${String(field.scrollHeight)}px`;
    };
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? field.getBoundingClientRect().width;
      if (Math.abs(nextWidth - observedWidth) < 0.5) return;
      observedWidth = nextWidth;
      fit();
    });
    observer.observe(field);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [fieldRef]);
}
