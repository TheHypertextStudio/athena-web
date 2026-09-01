import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../src/primitives/sheet';

describe('Sheet presentations', () => {
  it('gives a responsive sheet one named body scroll owner', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent presentation="responsive-fullscreen" size="wide">
          <SheetHeader>
            <SheetTitle>Event details</SheetTitle>
          </SheetHeader>
          <SheetBody data-testid="body">content</SheetBody>
          <SheetFooter>
            <button type="button">Close</button>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );

    const sheet = screen.getByRole('dialog', { name: 'Event details' });
    expect(sheet).toHaveAttribute('data-surface-tone', 'floating');
    expect(sheet).toHaveClass('overflow-hidden', 'gap-0', 'p-0', 'inset-0');
    expect(screen.getByTestId('body')).toHaveAttribute('data-overlay-scroll-owner', '');
    expect(screen.getByTestId('body')).toHaveClass('overflow-y-auto');
  });

  it('uses a bounded desktop edge panel for a responsive fullscreen sheet', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent presentation="responsive-fullscreen" side="right" size="standard">
          <SheetTitle>Inspect event</SheetTitle>
          <SheetDescription>Read event details without leaving the calendar.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('dialog', { name: 'Inspect event' })).toHaveClass(
      'sm:right-0',
      'sm:border-l',
      'w-96',
    );
  });

  // Each side's anchor has to be a complete class name in the source, because that is the only
  // form Tailwind generates a rule for. Asserting both sides here keeps the pair spelled out:
  // an anchor assembled from a variable still renders this exact attribute and still matches
  // nothing, so a test that only reads the class list cannot tell the two apart on its own.
  it.each([
    { side: 'left' as const, anchor: 'sm:left-0', release: 'sm:right-auto', border: 'sm:border-r' },
    {
      side: 'right' as const,
      anchor: 'sm:right-0',
      release: 'sm:left-auto',
      border: 'sm:border-l',
    },
  ])(
    'anchors a responsive fullscreen sheet to its $side edge on desktop',
    ({ side, anchor, release, border }) => {
      render(
        <Sheet defaultOpen>
          <SheetContent presentation="responsive-fullscreen" side={side} size="navigation">
            <SheetTitle>Navigate</SheetTitle>
            <SheetDescription>Move between sections.</SheetDescription>
          </SheetContent>
        </Sheet>,
      );

      const sheet = screen.getByRole('dialog', { name: 'Navigate' });
      // The phone layout still fills the screen.
      expect(sheet).toHaveClass('inset-0', 'h-[100dvh]');
      // On desktop it pins to its own edge, releases the opposite one that `inset-0` pinned,
      // and carries the border that faces the page.
      expect(sheet).toHaveClass(anchor, release, border, 'sm:w-auto', 'w-72');
    },
  );
});
