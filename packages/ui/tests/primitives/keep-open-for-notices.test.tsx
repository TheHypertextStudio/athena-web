import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../src/primitives/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../src/primitives/sheet';

afterEach(cleanup);

/** Stand-in for the notice stack, which sonner mounts outside every modal. */
function NoticeStack(): React.JSX.Element {
  return (
    <ol data-sonner-toaster="">
      <li>
        <button type="button">Try again</button>
      </li>
    </ol>
  );
}

/** The stand-in notice's action; a modal hides outside content from role queries. */
function noticeButton(): Element {
  const button = document.querySelector('[data-sonner-toaster] button');
  if (!button) throw new Error('The notice stack was not rendered');
  return button;
}

/** Press and release the pointer on an element the way a person clicks it. */
function press(target: Element): void {
  fireEvent.pointerDown(target);
  fireEvent.pointerUp(target);
  fireEvent.click(target);
}

describe('modals and notices', () => {
  it('keeps a dialog open when a notice is pressed', async () => {
    const onOpenChange = vi.fn();
    render(
      <>
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Account</DialogDescription>
          </DialogContent>
        </Dialog>
        <NoticeStack />
      </>,
    );
    await screen.findByRole('dialog');

    press(noticeButton());

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('still closes a dialog when the page behind it is pressed', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Account</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole('dialog');

    press(document.body);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hands every other outside interaction to the caller', async () => {
    const onInteractOutside = vi.fn();
    render(
      <Dialog open>
        <DialogContent onInteractOutside={onInteractOutside}>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Account</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole('dialog');

    press(document.body);

    expect(onInteractOutside).toHaveBeenCalledTimes(1);
  });

  it('keeps a sheet open when a notice is pressed', async () => {
    const onOpenChange = vi.fn();
    render(
      <>
        <Sheet open onOpenChange={onOpenChange}>
          <SheetContent>
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Move around</SheetDescription>
          </SheetContent>
        </Sheet>
        <NoticeStack />
      </>,
    );
    await screen.findByRole('dialog');

    press(noticeButton());

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
