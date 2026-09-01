import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../src/primitives/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../src/primitives/dialog';
import { Input } from '../../src/primitives/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../src/primitives/sheet';

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

/** Like {@link TriggerlessDialog}, but forwards a caller-supplied `onCloseAutoFocus`. */
function TriggerlessDialog2({
  onCloseAutoFocus,
}: {
  onCloseAutoFocus: (event: Event) => void;
}): React.JSX.Element {
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
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give it a name to get started.</DialogDescription>
          <Input aria-label="Project name" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A destructive confirmation opened from an already-modal sheet. */
function SheetConfirmation({ onConfirm }: { onConfirm: () => void }): React.JSX.Element {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  return (
    <Sheet defaultOpen>
      <SheetContent>
        <SheetTitle>Calendar item</SheetTitle>
        <SheetDescription>Review the selected calendar item.</SheetDescription>
        <Button
          onClick={() => {
            setConfirmationOpen(true);
          }}
        >
          Delete item
        </Button>
        <Dialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
          <DialogContent showClose={false}>
            <DialogTitle>Delete calendar item?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
            <Button onClick={onConfirm}>Confirm delete</Button>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
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
    expect(dialog).toHaveClass('max-h-[85vh]', 'min-h-0', 'overflow-hidden', 'overscroll-contain');
    expect(dialog).not.toHaveClass('touch-pan-y');
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
    const overlay = baseElement.querySelector('[data-overlay-scrim]');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass('bg-scrim/40', 'z-[110]');
    expect(screen.getByRole('dialog')).toHaveClass('z-[110]');
  });

  it.each([
    {
      kind: 'fullscreen' as const,
      size: 'standard' as const,
      height: 'content' as const,
      expected: ['inset-0', 'h-[100dvh]', 'w-[100vw]'],
    },
    {
      kind: 'bottom-sheet' as const,
      size: 'standard' as const,
      height: 'medium' as const,
      expected: ['inset-x-0', 'bottom-0', 'h-[min(60dvh,36rem)]'],
    },
    {
      kind: 'responsive-fullscreen' as const,
      size: 'wide' as const,
      height: 'tall' as const,
      expected: ['inset-0', 'max-w-4xl', 'h-[min(80dvh,48rem)]'],
    },
    {
      kind: 'top' as const,
      size: 'compact' as const,
      height: 'viewport' as const,
      expected: ['top-3', 'max-w-sm', 'h-[calc(100dvh-1.5rem)]'],
    },
  ])('renders the $kind presentation through the shared geometry contract', async (testCase) => {
    render(
      <Dialog defaultOpen>
        <DialogContent
          presentation={{ kind: testCase.kind, size: testCase.size, height: testCase.height }}
        >
          <DialogTitle>{testCase.kind}</DialogTitle>
          <DialogDescription>Presentation test</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(await screen.findByRole('dialog')).toHaveClass(...testCase.expected);
  });

  it('renders a hosted dialog in its supplied portal without a backdrop', async () => {
    const portal = document.createElement('div');
    document.body.append(portal);
    render(
      <Dialog defaultOpen>
        <DialogContent
          presentation={{
            kind: 'hosted',
            portalContainer: portal,
            backdrop: 'none',
            size: 'detail',
            height: 'content',
            position: { top: 12, left: 20, width: 480, maxHeight: 600 },
          }}
        >
          <DialogTitle>Hosted</DialogTitle>
          <DialogDescription>Hosted presentation test</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Hosted' });
    expect(portal).toContainElement(dialog);
    expect(dialog).toHaveClass('pointer-events-auto', 'max-w-5xl', 'max-h-[min(85dvh,48rem)]');
    expect(dialog).toHaveStyle({ top: '12px', left: '20px', width: '480px', maxHeight: '600px' });
    expect(portal.querySelector('[data-overlay-scrim]')).toBeNull();
    portal.remove();
  });

  it('uses the hosted surface backdrop and permits a visible non-scrolling body', async () => {
    const portal = document.createElement('div');
    document.body.append(portal);
    render(
      <Dialog defaultOpen>
        <DialogContent
          presentation={{
            kind: 'hosted',
            portalContainer: portal,
            backdrop: 'surface',
            position: { top: 0, left: 0, width: 320, maxHeight: 480 },
          }}
        >
          <DialogTitle>Hosted surface</DialogTitle>
          <DialogDescription>Hosted backdrop test</DialogDescription>
          <DialogBody inset="none" scroll="visible" data-testid="visible-dialog-body">
            Body
          </DialogBody>
        </DialogContent>
      </Dialog>,
    );

    await screen.findByRole('dialog', { name: 'Hosted surface' });
    expect(portal.querySelector('[data-overlay-scrim]')).toHaveClass('bg-surface');
    expect(screen.getByTestId('visible-dialog-body')).not.toHaveAttribute(
      'data-overlay-scroll-owner',
    );
    expect(screen.getByTestId('visible-dialog-body')).not.toHaveClass('overflow-y-auto');
    portal.remove();
  });

  it('keeps a confirmation dialog and its scrim above the sheet that opened it', async () => {
    const onConfirm = vi.fn();
    const { baseElement } = render(<SheetConfirmation onConfirm={onConfirm} />);
    const sheet = await screen.findByRole('dialog', { name: 'Calendar item' });
    expect(sheet).toHaveClass('z-[100]');

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));

    const confirmation = await screen.findByRole('dialog', { name: 'Delete calendar item?' });
    const overlays = baseElement.querySelectorAll('[data-overlay-scrim]');
    const confirmationOverlay = overlays.item(overlays.length - 1);
    expect(confirmationOverlay).toHaveClass('z-[110]');
    expect(confirmation).toHaveClass('z-[110]');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not crash and skips focus restore when the pre-open active element is not an HTMLElement', async () => {
    // An icon-only SVG trigger with a tabIndex is a real pattern (a bare icon affordance); SVG
    // elements are not HTMLElements, so the opener-capture code's `instanceof HTMLElement` guard
    // takes its false branch and simply does not try to restore focus to it.
    function SvgOpenedDialog(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <svg
            tabIndex={0}
            role="button"
            aria-label="Open via icon"
            data-testid="svg-opener"
            onClick={() => {
              setOpen(true);
            }}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Panel</DialogTitle>
              <DialogDescription>Opened from a non-HTMLElement trigger.</DialogDescription>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    render(<SvgOpenedDialog />);
    const svgOpener = screen.getByTestId('svg-opener');
    svgOpener.focus();
    fireEvent.click(svgOpener);
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // No crash, and focus does not land back on the (non-HTMLElement) opener.
    expect(document.body).toHaveFocus();
  });

  it('honors a caller onCloseAutoFocus that already called preventDefault', async () => {
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
    });
    render(<TriggerlessDialog2 onCloseAutoFocus={onCloseAutoFocus} />);
    const opener = screen.getByRole('button', { name: 'New project' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onCloseAutoFocus).toHaveBeenCalledTimes(1);
    // The caller already prevented the default, so this component must not also refocus the
    // opener — the assertion is simply that it does not crash and the opener is left alone.
    expect(opener).not.toHaveFocus();
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
