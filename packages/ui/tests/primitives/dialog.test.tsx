import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from '../../src/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../src/primitives/dialog';
import { Input } from '../../src/primitives/input';

/** A controlled host that mirrors the Linear create-flow usage of the Dialog. */
function ControlledDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give it a name to get started.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Project name" autoFocus />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A controlled host opened from a plain button with NO `DialogTrigger` — the exact pattern the
 * Docket create flows use (the list page owns `open` and toggles it from a header button).
 */
function TriggerlessDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        New project
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Give it a name to get started.</DialogDescription>
          </DialogHeader>
          {/* No `autoFocus`: FocusScope focuses the first field on open and restores focus on close. */}
          <Input aria-label="Project name" />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog family', () => {
  it('opens from its trigger and renders the panel as a labelled modal dialog', async () => {
    render(<ControlledDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open dialog'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Radix labels the panel by the DialogTitle and describes it by the DialogDescription.
    expect(dialog).toHaveAccessibleName('New project');
    expect(dialog).toHaveAccessibleDescription('Give it a name to get started.');
    expect(dialog).toHaveClass('bg-surface-container-high', 'rounded-xl');
  });

  it('moves focus into the dialog on open (the autoFocused primary field)', async () => {
    render(<ControlledDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    await screen.findByRole('dialog');

    await waitFor(() => {
      expect(screen.getByLabelText('Project name')).toHaveFocus();
    });
  });

  it('closes when Escape is pressed', async () => {
    render(<ControlledDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes via the built-in close button', async () => {
    render(<ControlledDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes via a DialogClose action (Cancel)', async () => {
    render(<ControlledDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('focuses the first field on open and returns focus to the opener on close (no DialogTrigger)', async () => {
    render(<TriggerlessDialog />);
    const opener = screen.getByRole('button', { name: 'New project' });
    opener.focus();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    // FocusScope moves focus to the first focusable field on open.
    await waitFor(() => {
      expect(screen.getByLabelText('Project name')).toHaveFocus();
    });

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // WAI-ARIA: focus returns to the element that opened the dialog, not to <body>.
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('omits the built-in close button when showClose is false', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showClose={false}>
          <DialogTitle>No close X</DialogTitle>
          <DialogDescription>
            The dialog deliberately omits the chrome close button.
          </DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('renders a scrim overlay behind the panel', async () => {
    const { baseElement } = render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>With scrim</DialogTitle>
          <DialogDescription>The dialog renders above a dimmed page scrim.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole('dialog');
    // The overlay is a portalled sibling carrying the dimmed-scrim token classes.
    const overlay = baseElement.querySelector('.bg-black\\/40');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass('z-[110]');
    expect(screen.getByRole('dialog')).toHaveClass('z-[110]');
  });

  it('merges custom classes onto the content, header, footer, title, and description', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent className="content-x">
          <DialogHeader className="header-x">
            <DialogTitle className="title-x">Styled</DialogTitle>
            <DialogDescription className="desc-x">Body</DialogDescription>
          </DialogHeader>
          <DialogFooter className="footer-x">
            <Button>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('content-x');
    expect(screen.getByText('Styled')).toHaveClass('title-x', 'text-on-surface');
    expect(screen.getByText('Body')).toHaveClass('desc-x', 'text-on-surface-variant');
    expect(screen.getByText('Styled').closest('.header-x')).not.toBeNull();
    expect(screen.getByText('OK').closest('.footer-x')).not.toBeNull();
  });
});
