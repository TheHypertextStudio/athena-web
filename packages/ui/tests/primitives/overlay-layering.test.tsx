import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '../../src/primitives/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../src/primitives/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../../src/primitives/popover';

/**
 * Regression guard for the "picker renders behind the modal" bug: a transient overlay (popover,
 * dropdown menu, …) opened from inside a `Dialog` must stack ABOVE the dialog's `z-[110]` modal
 * layer, not behind its scrim. Transient overlays live at `z-[120]`.
 */
describe('overlay layering above modals', () => {
  it('renders a popover opened inside a dialog above the dialog layer', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>New project</DialogTitle>
          <Popover defaultOpen>
            <PopoverTrigger>Link initiatives</PopoverTrigger>
            <PopoverContent>Pick one</PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'New project' })).toHaveClass('z-[110]');
    // The popover panel is a portalled sibling; it must sit above the modal layer.
    const panel = await screen.findByText('Pick one');
    expect(panel).toHaveClass('z-[120]');
  });

  it('renders a dropdown menu opened inside a dialog above the dialog layer', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>New project</DialogTitle>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>Set lead</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Someone</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogContent>
      </Dialog>,
    );

    const menu = await screen.findByRole('menu');
    expect(menu).toHaveClass('z-[120]');
  });
});
