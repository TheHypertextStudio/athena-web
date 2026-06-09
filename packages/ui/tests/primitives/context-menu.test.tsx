import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../src/primitives/context-menu';

/** Open a Radix context menu by firing a right-click (contextmenu) on its trigger region. */
function openContextMenu(trigger: HTMLElement): void {
  fireEvent.contextMenu(trigger);
}

describe('ContextMenu family', () => {
  it('renders the full menu surface on right-click (items, label, checkbox, radio, separators, shortcuts, submenu)', async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Row region</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Section</ContextMenuLabel>
          <ContextMenuLabel inset>Inset Section</ContextMenuLabel>
          <ContextMenuGroup>
            <ContextMenuItem>
              Rename
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem inset>Inset item</ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked>Pinned</ContextMenuCheckboxItem>
          <ContextMenuRadioGroup value="p1">
            <ContextMenuRadioItem value="p1">Priority one</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent>
                <ContextMenuItem>Nested target</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger inset>Sub inset</ContextMenuSubTrigger>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );

    openContextMenu(screen.getByText('Row region'));

    await waitFor(() => {
      expect(screen.getByText('Section')).toBeInTheDocument();
    });
    expect(screen.getByText('Inset Section')).toHaveClass('pl-8');
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Inset item')).toHaveClass('pl-8');
    expect(screen.getByText('⌘R')).toHaveClass('ml-auto');
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Priority one')).toBeInTheDocument();
    expect(screen.getByText('Move to')).toBeInTheDocument();
    expect(screen.getByText('Sub inset')).toHaveClass('pl-8');
  });

  it('applies the shared inset focus ring to interactive items', async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Region</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    openContextMenu(screen.getByText('Region'));
    const item = await screen.findByText('Delete');
    // The one focus convention: a 1px inset ring on dense rows.
    expect(item).toHaveClass(
      'focus-visible:ring-1',
      'focus-visible:ring-ring',
      'focus-visible:ring-inset',
    );
  });

  it('invokes onSelect when an item is chosen', async () => {
    function Harness(): React.JSX.Element {
      const [chosen, setChosen] = useState('');
      return (
        <>
          <span data-testid="chosen">{chosen}</span>
          <ContextMenu>
            <ContextMenuTrigger>Region</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  setChosen('renamed');
                }}
              >
                Rename
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </>
      );
    }
    render(<Harness />);
    openContextMenu(screen.getByText('Region'));
    fireEvent.click(await screen.findByText('Rename'));

    await waitFor(() => {
      expect(screen.getByTestId('chosen')).toHaveTextContent('renamed');
    });
  });

  it('opens the submenu content via the sub-trigger to render SubContent', async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Region</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Submenu</ContextMenuSubTrigger>
            <ContextMenuSubContent className="sub-x">
              <ContextMenuItem>Inside sub</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );

    openContextMenu(screen.getByText('Region'));
    const trigger = await screen.findByText('Submenu');
    fireEvent.pointerMove(trigger);
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText('Inside sub')).toBeInTheDocument();
    });
  });
});
