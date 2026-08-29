import { type KeyboardEvent, useCallback } from 'react';

import type { PaletteItem } from './types';

interface UsePaletteKeyboardInput {
  items: readonly PaletteItem[];
  activeId: string | null;
  setActiveId: (next: string | null) => void;
  runItem: (item: PaletteItem) => void;
  onClose: () => void;
}

interface UsePaletteKeyboardOutput {
  runActive: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** usePaletteKeyboard coordinates command palette state, loading, and mutations for its screen. */
export function usePaletteKeyboard({
  items,
  activeId,
  setActiveId,
  runItem,
  onClose,
}: UsePaletteKeyboardInput): UsePaletteKeyboardOutput {
  const runActive = useCallback(() => {
    const item = items.find((candidate) => candidate.id === activeId);
    if (item) runItem(item);
  }, [items, activeId, runItem]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (items.length === 0) {
            setActiveId(null);
            break;
          }
          setActiveId(
            items[
              (Math.max(
                0,
                items.findIndex((item) => item.id === activeId),
              ) +
                1) %
                items.length
            ]?.id ?? null,
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (items.length === 0) {
            setActiveId(null);
            break;
          }
          setActiveId(
            items[
              (Math.max(
                0,
                items.findIndex((item) => item.id === activeId),
              ) -
                1 +
                items.length) %
                items.length
            ]?.id ?? null,
          );
          break;
        case 'Enter':
          event.preventDefault();
          runActive();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    },
    [items, activeId, setActiveId, runActive, onClose, dialogRef],
  );

  return { runActive, onKeyDown };
}
