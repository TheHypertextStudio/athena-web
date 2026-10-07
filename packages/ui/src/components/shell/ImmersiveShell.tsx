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
  /** Activity-owned navigation that stays visible while its panels scroll. */
  readonly header?: React.ReactNode;
  /** Primary activity actions stay outside the scrolling panels. */
  readonly footer?: React.ReactNode;
  readonly banner?: React.ReactNode;
  readonly contentOverlay?: React.ReactNode;
}

/** Keep shared theme, scrolling, safe areas and overlays without application navigation. */
export function ImmersiveShell({
  children,
  header,
  footer,
  banner,
  contentOverlay,
}: ImmersiveShellProps): React.JSX.Element {
  const { orgAccent, density } = useContextState();
  const scrollOwner = usePageScrollOwner();
  const [overlayHost, setOverlayHost] = React.useState<HTMLDivElement | null>(null);
  return (
    <ShellOverlayProvider host={overlayHost}>
      <Surface
        tone="canvas"
        shape="none"
        data-navigation-context="activity"
        data-density={density}
        style={orgAccent ? ({ '--org-accent': orgAccent } as React.CSSProperties) : undefined}
        className="relative flex h-dvh w-full min-w-0 justify-center overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] sm:p-4 lg:p-6"
      >
        <Surface
          tone="page"
          shape="none"
          data-activity-workspace=""
          className="sm:rounded-corner-lg relative flex h-full w-full max-w-[1320px] min-w-0 flex-col overflow-hidden"
        >
          {contentOverlay}
          {header ? <div className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">{header}</div> : null}
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
          {footer ? (
            <footer className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
              {footer}
            </footer>
          ) : null}
          <div
            ref={setOverlayHost}
            data-shell-overlay-host=""
            className="pointer-events-none absolute inset-0 z-(--z-shell-overlay) overflow-hidden"
          />
        </Surface>
      </Surface>
    </ShellOverlayProvider>
  );
}
