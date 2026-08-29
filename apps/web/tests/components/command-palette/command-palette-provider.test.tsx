import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  CommandPaletteHost,
  CommandPaletteProvider,
  useCommandPalette,
} from '@/components/command-palette/command-palette-provider';

vi.mock('@/components/command-palette/command-palette', () => ({
  CommandPalette: ({
    open,
    onOpenPanel,
    panelsAvailable,
  }: {
    open: boolean;
    onOpenPanel: (panelId: 'agenda' | 'focus' | 'athena') => void;
    panelsAvailable: boolean;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onOpenPanel('focus');
        }}
      >
        {panelsAvailable ? 'Open Focus' : 'Panels unavailable'}
      </button>
    ) : null,
}));

function OpenPalette({ children }: { children: ReactNode }) {
  const { openPalette } = useCommandPalette();
  return (
    <>
      <button type="button" onClick={openPalette}>
        Open palette
      </button>
      {children}
    </>
  );
}

describe('CommandPaletteHost', () => {
  it('keeps shortcut state in the provider while the shell host executes panel requests', () => {
    const onOpenPanel = vi.fn();

    render(
      <CommandPaletteProvider>
        <OpenPalette>
          <CommandPaletteHost
            panelsAvailable
            onOpenPanel={onOpenPanel}
            sessionOwnerUserId="user-1"
          />
        </OpenPalette>
      </CommandPaletteProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open palette' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Focus' }));

    expect(onOpenPanel).toHaveBeenCalledWith('focus');
  });
});
