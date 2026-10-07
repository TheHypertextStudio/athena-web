'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { Surface } from '../../primitives/surface';
import { useContextState } from './ContextProvider';
import { usePageScrollOwner } from './page-scroll';
import { ShellOverlayProvider } from './ShellOverlayContext';

/** Slots for a focused activity that owns navigation within the full window. */
export interface ImmersiveShellProps {
  readonly children: React.ReactNode;
  readonly banner?: React.ReactNode;
  readonly contentOverlay?: React.ReactNode;
}

/** Keep shared theme, scrolling, safe areas and overlays without application navigation. */
export function ImmersiveShell({
  children,
  banner,
  contentOverlay,
}: ImmersiveShellProps): React.JSX.Element {
  const { orgAccent, density } = useContextState();
  const scrollOwner = usePageScrollOwner();
  const [overlayHost, setOverlayHost] = React.useState<HTMLDivElement | null>(null);
  return (
    <ShellOverlayProvider host={overlayHost}>
      <Surface
        tone="page"
        shape="none"
        data-navigation-context="activity"
        data-density={density}
        style={orgAccent ? ({ '--org-accent': orgAccent } as React.CSSProperties) : undefined}
        className="relative flex h-dvh w-full min-w-0 flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
      >
        {contentOverlay}
        {banner ? <div className="shrink-0">{banner}</div> : null}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            '@container isolate min-h-0 min-w-0 flex-1 outline-none',
            scrollOwner === 'shell'
              ? 'scrollbar-gutter-stable overflow-auto pb-[env(safe-area-inset-bottom)]'
              : 'overflow-hidden',
          )}
        >
          {children}
        </main>
        <div
          ref={setOverlayHost}
          data-shell-overlay-host=""
          className="pointer-events-none absolute inset-0 z-(--z-shell-overlay) overflow-hidden"
        />
      </Surface>
    </ShellOverlayProvider>
  );
}
