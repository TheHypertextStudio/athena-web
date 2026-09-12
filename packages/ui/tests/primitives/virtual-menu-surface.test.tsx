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
    // Both bounds clamp to the viewport: a bare `min-w-72` would outrank the ceiling and push
    // the menu wider than a narrow screen.
    expect(menu).toHaveClass(
      'min-w-[min(18rem,calc(100vw-1.5rem))]',
      'w-max',
      'max-w-[min(28rem,calc(100vw-1.5rem))]',
    );
    expect(menu).toHaveStyle({ maxHeight: '240px' });
  });
});
