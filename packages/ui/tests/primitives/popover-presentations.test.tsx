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
        <PopoverContent presentation="panel" width="lg" aria-label="Inspector">
          <PopoverHeader>Inspector</PopoverHeader>
          <PopoverBody data-testid="body">content</PopoverBody>
          <PopoverFooter>
            <button type="button">Done</button>
          </PopoverFooter>
        </PopoverContent>
      </Popover>,
    );

    const panel = await screen.findByLabelText('Inspector');
    expect(panel).toHaveAttribute('data-surface-tone', 'floating');
    expect(panel).toHaveClass('overflow-hidden', 'gap-0', 'p-0', 'w-72');
    expect(screen.getByTestId('body')).toHaveAttribute('data-overlay-scroll-owner', '');
    expect(screen.getByTestId('body')).toHaveClass('overflow-y-auto');
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

    expect(await screen.findByLabelText('Actions')).toHaveClass('w-48', 'min-w-0');
  });
});
