import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../../src/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../src/primitives/tooltip';

/**
 * A tooltip naming an icon-only control, mirroring the shell's intended usage. `delayDuration={0}`
 * removes the hover dwell so the test does not depend on a timer.
 */
function IconTooltip(): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" aria-label="Filter">
            F
          </Button>
        </TooltipTrigger>
        <TooltipContent className="tip-x">Filter issues</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('Tooltip family', () => {
  it('is closed until the trigger is focused, then reveals its label', async () => {
    render(<IconTooltip />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Keyboard focus is the deterministic open path (Radix's hover path needs a full pointer
    // sequence jsdom does not synthesise); focus exercises the same content render + a11y wiring.
    fireEvent.focus(screen.getByRole('button', { name: 'Filter' }));

    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Filter issues');
  });

  it('closes again when the trigger loses focus', async () => {
    render(<IconTooltip />);
    const trigger = screen.getByRole('button', { name: 'Filter' });
    fireEvent.focus(trigger);
    await screen.findByRole('tooltip');

    fireEvent.blur(trigger);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('merges a custom class and applies the MD3 surface tone onto the content', async () => {
    render(<IconTooltip />);
    fireEvent.focus(screen.getByRole('button', { name: 'Filter' }));
    // Radix renders the visible content plus a visually-hidden a11y copy; assert on the styled,
    // class-carrying visible surface.
    await waitFor(() => {
      const styled = document.querySelector('.tip-x');
      expect(styled).not.toBeNull();
      expect(styled).toHaveClass('bg-surface-container-highest', 'rounded-lg', 'text-xs');
    });
  });
});
