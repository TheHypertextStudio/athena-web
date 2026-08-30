'use client';

import * as React from 'react';

import type { MenuWidth } from './menu-styles';
import { Popover, PopoverAnchor, PopoverContent, type PopoverVirtualAnchorRef } from './popover';

/** Props for a menu whose anchor comes from virtual geometry such as an editor caret. */
export interface VirtualMenuSurfaceProps {
  /** Virtual anchor that supplies the current viewport rectangle. */
  readonly anchor: PopoverVirtualAnchorRef;
  /** The largest useful height before the menu itself scrolls. */
  readonly estimatedHeight: number;
  /** Shared menu width tier. */
  readonly width?: MenuWidth | undefined;
  /** Separation between the virtual anchor and the menu. */
  readonly sideOffset?: number | undefined;
  /** Menu body. */
  readonly children: React.ReactNode;
}

/**
 * Render a viewport-clamped menu from a virtual anchor.
 *
 * The wrapper owns portal placement, collision handling, the shared menu surface, and the one
 * scroll region. Consumers provide content and anchor geometry only, so an editor mention list
 * cannot recreate another fixed-positioned menu shell with its own edge math.
 */
export function VirtualMenuSurface({
  anchor,
  estimatedHeight,
  width = 'lg',
  sideOffset = 4,
  children,
}: VirtualMenuSurfaceProps): React.JSX.Element {
  return (
    <Popover defaultOpen>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        presentation="menu"
        width={width}
        sideOffset={sideOffset}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        role="presentation"
        data-overlay-scroll-owner=""
        style={{ maxHeight: `${estimatedHeight}px` }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
