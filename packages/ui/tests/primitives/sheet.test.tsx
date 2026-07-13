import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from '../../src/primitives/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../src/primitives/sheet';

/** A controlled left-side sheet mirroring the shell's mobile navigation drawer usage. */
function NavSheet(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>Open navigation</SheetTrigger>
      <SheetContent side="left">
        <SheetTitle>Navigation</SheetTitle>
        <SheetDescription>Jump to a destination.</SheetDescription>
        <a href="/today">Today</a>
        <SheetClose asChild>
          <Button variant="ghost">Done</Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A controlled sheet opened from a STANDALONE button (no `SheetTrigger`) — exactly how the app
 * shell opens the mobile navigation drawer. Radix's built-in focus-restore only covers a
 * `SheetTrigger`, so this exercises the primitive's own opener capture/restore.
 */
function ControlledNavSheet(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Menu
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Jump to a destination.</SheetDescription>
          <a href="/today">Today</a>
        </SheetContent>
      </Sheet>
    </>
  );
}

describe('Sheet family', () => {
  it('opens from its trigger as a labelled, described modal dialog', async () => {
    render(<NavSheet />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open navigation'));

    const sheet = await screen.findByRole('dialog');
    expect(sheet).toBeInTheDocument();
    // Radix wires aria-labelledby/aria-describedby from the title + description.
    expect(sheet).toHaveAccessibleName('Navigation');
    expect(sheet).toHaveAccessibleDescription('Jump to a destination.');
  });

  it('anchors to the left edge with the panel surface tone', async () => {
    render(<NavSheet />);
    fireEvent.click(screen.getByText('Open navigation'));
    const sheet = await screen.findByRole('dialog');
    // Left-anchored geometry + the solid MD3 surface tone so the drawer reads over the scrim.
    expect(sheet).toHaveClass('bg-surface', 'left-0', 'inset-y-0', 'border-r');
  });

  it('anchors to the right edge when side="right"', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="right">
          <SheetTitle>Right panel</SheetTitle>
          <SheetDescription>The right-side sheet slides in from the right edge.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveClass('right-0', 'border-l');
    expect(sheet).not.toHaveClass('left-0');
  });

  it('renders the modal scrim and panel above app-local sticky layers', async () => {
    const { baseElement } = render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>With scrim</SheetTitle>
          <SheetDescription>The sheet renders above a dimmed page scrim.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog');
    const overlay = baseElement.querySelector('.bg-black\\/40');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass('z-[100]');
    expect(sheet).toHaveClass('z-[100]');
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<NavSheet />);
    const opener = screen.getByText('Open navigation');
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole('dialog');

    fireEvent.keyDown(sheet, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // WAI-ARIA: focus returns to the element that opened the sheet.
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('returns focus to a standalone opener (no SheetTrigger) on close — the shell drawer pattern', async () => {
    render(<ControlledNavSheet />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole('dialog');

    fireEvent.keyDown(sheet, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // The drawer is opened from a controlled button, not a SheetTrigger; focus must still return.
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('closes via a SheetClose action', async () => {
    render(<NavSheet />);
    fireEvent.click(screen.getByText('Open navigation'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('merges a custom class onto the panel', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent className="panel-x">
          <SheetTitle>Styled</SheetTitle>
          <SheetDescription>The sheet accepts caller-provided panel classes.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveClass('panel-x');
  });
});
