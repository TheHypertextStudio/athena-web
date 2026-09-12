import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogBody, DialogContent, DialogTitle } from '../../src/primitives/dialog';
import { OVERLAY_SCROLL_FALLBACK } from '../../src/primitives/overlay-inset';
import { Popover, PopoverBody, PopoverContent, PopoverTrigger } from '../../src/primitives/popover';
import { Sheet, SheetContent, SheetTitle } from '../../src/primitives/sheet';

/**
 * The fallback is a CSS `:has()` variant, and jsdom resolves no stylesheets, so a test can only
 * check that the surface carries it. What the class does once a browser applies it — the
 * `:not(:has(…))` outranking the panel's own `overflow-hidden` on the y axis — belongs to the
 * e2e overflow checks.
 */
const FALLBACK_CLASSES = OVERLAY_SCROLL_FALLBACK.split(' ');

describe('overlay scroll ownership', () => {
  it('lets a dialog scroll itself when nothing inside it claims the job', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent aria-label="Attach">
          <DialogTitle>Attach</DialogTitle>
          <p>A long unslotted body that would otherwise clip past the height cap.</p>
        </DialogContent>
      </Dialog>,
    );

    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveClass(...FALLBACK_CLASSES);
    expect(panel.querySelector('[data-overlay-scroll-owner]')).toBeNull();
  });

  it('hands scrolling to a dialog body when there is one', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent aria-label="Attach">
          <DialogTitle>Attach</DialogTitle>
          <DialogBody data-testid="body">Results</DialogBody>
        </DialogContent>
      </Dialog>,
    );

    const panel = await screen.findByRole('dialog');
    // The fallback class is always present; the body's marker is what switches it off, so the
    // header and footer stay put instead of scrolling with the content.
    expect(panel.querySelector('[data-overlay-scroll-owner]')).toBe(screen.getByTestId('body'));
    expect(screen.getByTestId('body')).toHaveClass('overflow-y-auto', 'overscroll-contain');
  });

  it('applies the same fallback to a panel popover', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent presentation="panel" width="lg" aria-label="Filters">
          <p>An exhaustive filter form with no body slot.</p>
        </PopoverContent>
      </Popover>,
    );

    expect(await screen.findByLabelText('Filters')).toHaveClass(...FALLBACK_CLASSES);
  });

  it('leaves a menu popover scrolling itself, as it always did', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent aria-label="Actions">Rename</PopoverContent>
      </Popover>,
    );

    const menu = await screen.findByLabelText('Actions');
    expect(menu).toHaveClass('overflow-y-auto', 'overflow-x-hidden');
    expect(menu).not.toHaveClass(...FALLBACK_CLASSES);
  });

  it('applies the fallback to a sheet, and stands down for a sheet body', async () => {
    const { rerender } = render(
      <Sheet defaultOpen>
        <SheetContent aria-label="Details">
          <SheetTitle>Details</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveClass(...FALLBACK_CLASSES);
    expect(panel.querySelector('[data-overlay-scroll-owner]')).toBeNull();

    rerender(
      <Sheet defaultOpen>
        <SheetContent aria-label="Details">
          <SheetTitle>Details</SheetTitle>
          <PopoverBody data-testid="sheet-body">Body</PopoverBody>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').querySelector('[data-overlay-scroll-owner]')).toBe(
      screen.getByTestId('sheet-body'),
    );
  });
});
