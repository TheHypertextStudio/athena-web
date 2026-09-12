import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
} from '../../src/primitives/popover';

describe('Popover presentations', () => {
  it('keeps panel geometry and scrolling in shared named slots', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open inspector</PopoverTrigger>
        <PopoverContent presentation="panel" width="lg" maxHeight="picker" aria-label="Inspector">
          <PopoverHeader>Inspector</PopoverHeader>
          <PopoverBody data-testid="body" scroll="hidden">
            content
          </PopoverBody>
          <PopoverFooter>
            <button type="button">Done</button>
          </PopoverFooter>
        </PopoverContent>
      </Popover>,
    );

    const panel = await screen.findByLabelText('Inspector');
    expect(panel).toHaveAttribute('data-surface-tone', 'floating');
    expect(panel).toHaveClass('z-[120]', 'pointer-events-auto');
    expect(panel).toHaveClass('overflow-hidden', 'gap-0', 'p-0', 'w-72');
    expect(panel).toHaveClass('max-h-[min(520px,var(--radix-popover-content-available-height))]');
    expect(screen.getByTestId('body')).not.toHaveAttribute('data-overlay-scroll-owner');
    expect(screen.getByTestId('body')).toHaveClass('overflow-hidden');
  });

  it('uses the menu surface for an action list', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open actions</PopoverTrigger>
        <PopoverContent width="sm" aria-label="Actions">
          Rename
        </PopoverContent>
      </Popover>,
    );

    // A tier is a floor and a ceiling; the menu takes the width its rows need between them.
    expect(await screen.findByLabelText('Actions')).toHaveClass(
      'min-w-[min(12rem,calc(100vw-1.5rem))]',
      'w-max',
      'max-w-[min(16rem,calc(100vw-1.5rem))]',
    );
  });
});
