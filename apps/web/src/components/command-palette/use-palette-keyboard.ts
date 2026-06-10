import { type KeyboardEvent, type RefObject, useCallback } from 'react';

import type { PaletteItem } from './types';

interface UsePaletteKeyboardInput {
  items: readonly PaletteItem[];
  activeIndex: number;
  setActiveIndex: (updater: (prev: number) => number) => void;
  onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>;
}

interface UsePaletteKeyboardOutput {
  runActive: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function usePaletteKeyboard({
  items,
  activeIndex,
  setActiveIndex,
  onClose,
  dialogRef,
}: UsePaletteKeyboardInput): UsePaletteKeyboardOutput {
  const runActive = useCallback(() => {
    const item = items[activeIndex];
    if (item) item.run();
  }, [items, activeIndex]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
          break;
        case 'Enter':
          event.preventDefault();
          runActive();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'Tab': {
          const dialog = dialogRef.current;
          if (!dialog) break;
          const tabbables = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement);
          if (tabbables.length === 0) break;
          event.preventDefault();
          const current = document.activeElement as HTMLElement | null;
          const index = current ? tabbables.indexOf(current) : -1;
          const delta = event.shiftKey ? -1 : 1;
          const next = tabbables[(index + delta + tabbables.length) % tabbables.length];
          next?.focus();
          break;
        }
        default:
          break;
      }
    },
    [items.length, runActive, onClose, dialogRef],
  );

  return { runActive, onKeyDown };
}
