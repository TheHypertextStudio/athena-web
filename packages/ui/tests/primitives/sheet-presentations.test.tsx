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
});
