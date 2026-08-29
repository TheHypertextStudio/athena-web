import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { type PopoverVirtualAnchor, VirtualMenuSurface } from '../../src/primitives';

function VirtualMenu(): React.JSX.Element {
  const anchor = React.useRef<PopoverVirtualAnchor | null>({
    getBoundingClientRect: () => new DOMRect(16, 16, 1, 1),
  });
  return (
    <VirtualMenuSurface anchor={anchor} estimatedHeight={240} width="lg">
      <div role="listbox" aria-label="Suggestions">
        One result
      </div>
    </VirtualMenuSurface>
  );
}

describe('VirtualMenuSurface', () => {
  it('renders one viewport-clamped menu scroll owner from a virtual anchor', async () => {
    render(<VirtualMenu />);

    const menu = await screen.findByRole('presentation');
    expect(menu).toHaveAttribute('data-overlay-scroll-owner', '');
    expect(menu).toHaveClass('w-72', 'min-w-0', 'max-w-[calc(100vw-1.5rem)]');
    expect(menu).toHaveStyle({ maxHeight: '240px' });
  });
});
