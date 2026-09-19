import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast as sonner } from 'sonner';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Toaster } from '../../../src/components/feedback/Toaster';
import { notifyFailure } from '../../../src/components/feedback/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../src/primitives/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../../src/primitives/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../../src/primitives/sheet';

// A notice captures the pointer on press, which jsdom does not implement.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
});

// Sonner keeps its notices in module state, so each test starts from an empty stack.
afterEach(() => {
  sonner.dismiss();
  cleanup();
});

/** An overlay held open by the test, reporting every request to close it. */
interface OverlayCase {
  readonly name: string;
  /** Render the overlay open, calling `onOpenChange` when it asks to close. */
  readonly render: (onOpenChange: (open: boolean) => void) => React.JSX.Element;
}

const OVERLAYS: readonly OverlayCase[] = [
  {
    name: 'dialog',
    render: (onOpenChange) => (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Account</DialogDescription>
        </DialogContent>
      </Dialog>
    ),
  },
  {
    name: 'sheet',
    render: (onOpenChange) => (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Move around</SheetDescription>
        </SheetContent>
      </Sheet>
    ),
  },
  {
    name: 'popover',
    render: (onOpenChange) => (
      <Popover open onOpenChange={onOpenChange}>
        <PopoverTrigger>Open actions</PopoverTrigger>
        <PopoverContent aria-label="Actions">Rename</PopoverContent>
      </Popover>
    ),
  },
];

/** Press and release the pointer on an element the way a person clicks it, moving focus to it. */
function press(target: Element): void {
  fireEvent.pointerDown(target);
  if (target instanceof HTMLElement) target.focus();
  fireEvent.pointerUp(target);
  fireEvent.click(target);
}

/** Render the real notice stack beside an open overlay, with a failure notice on screen. */
async function openOverlayWithNotice(
  overlay: OverlayCase,
  onOpenChange: (open: boolean) => void,
  retry: () => void,
): Promise<HTMLElement> {
  render(
    <>
      {overlay.render(onOpenChange)}
      <Toaster />
    </>,
  );
  await act(async () => {
    notifyFailure({
      title: 'That change did not save.',
      action: { label: 'Try again', onSelect: retry },
    });
  });
  // A modal hides everything outside it from role queries, and the notice stack is outside.
  return screen.findByRole('button', { name: 'Try again', hidden: true });
}

describe.each(OVERLAYS)('a notice over an open $name', (overlay) => {
  it('leaves the overlay open when the notice action is pressed', async () => {
    const onOpenChange = vi.fn();
    const retry = vi.fn();
    const action = await openOverlayWithNotice(overlay, onOpenChange, retry);

    press(action);

    expect(retry).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('still asks to close the overlay when the page behind it is pressed', async () => {
    const onOpenChange = vi.fn();
    await openOverlayWithNotice(overlay, onOpenChange, vi.fn());

    press(document.body);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
