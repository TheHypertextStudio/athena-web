import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { usePaletteKeyboard } from '@/components/command-palette/use-palette-keyboard';
import type { PaletteItem } from '@/components/command-palette/types';
import { Settings } from '@docket/ui/icons';

function item(id: string): PaletteItem {
  return {
    id,
    section: 'results',
    label: id,
    icon: Settings,
    run: vi.fn(),
  };
}

describe('usePaletteKeyboard', () => {
  it('keeps the active result by id when a late source reorders the list', () => {
    const local = item('setting:security');
    const remote = item('task:security');
    let activeId: string | null = local.id;
    const setActiveId = vi.fn((next: string | null) => {
      activeId = next;
    });
    const { result, rerender } = renderHook(
      ({ items }) =>
        usePaletteKeyboard({
          items,
          activeId,
          setActiveId,
          runItem: (selected) => {
            selected.run();
          },
          onClose: vi.fn(),
          dialogRef: createRef<HTMLDivElement>(),
        }),
      { initialProps: { items: [local] as readonly PaletteItem[] } },
    );

    rerender({ items: [remote, local] });
    act(() => {
      result.current.runActive();
    });

    expect(local.run).toHaveBeenCalledOnce();
    expect(remote.run).not.toHaveBeenCalled();
  });
});
