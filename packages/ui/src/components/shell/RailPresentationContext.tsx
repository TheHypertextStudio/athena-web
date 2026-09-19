'use client';

/**
 * `@docket/ui` — which host is currently rendering a rail panel.
 *
 * @remarks
 * A rail panel's `node` is one React tree shared by two hosts: {@link ShellAside} docks it beside
 * `<main>` at `lg` and up, and the same node is rendered again inside the mobile utility
 * {@link Sheet} below `lg`. The sheet already shows its own title bar for the active panel (the
 * {@link MobilePanelSwitcher} trigger plus a close button), so a panel that also renders its own
 * mark-and-name header doubles it. This tells a panel which host it is in so it can drop its own
 * header only where the shell already supplies one, without hard-coding a viewport query into
 * panel content that has no other reason to know about breakpoints.
 *
 * Defaults to `'docked'`, so a panel rendered with no provider (in isolation, or in a test) keeps
 * its own header — the safer default, since the docked host never supplies one of its own.
 */
import * as React from 'react';

/** Which host is currently rendering a rail panel's `node`. */
export type RailPresentation = 'docked' | 'sheet';

/** Props for {@link RailPresentationProvider}. */
export interface RailPresentationProviderProps {
  readonly value: RailPresentation;
  readonly children: React.ReactNode;
}

const RailPresentationContext = React.createContext<RailPresentation>('docked');

/** Provider wrapping a rail panel's `node` with the host that is currently rendering it. */
export function RailPresentationProvider({
  value,
  children,
}: RailPresentationProviderProps): React.JSX.Element {
  return (
    <RailPresentationContext.Provider value={value}>{children}</RailPresentationContext.Provider>
  );
}

/**
 * Read which host is currently rendering the calling rail panel.
 *
 * @returns `'docked'` outside a provider, matching the host that renders no header of its own.
 */
export function useRailPresentation(): RailPresentation {
  return React.useContext(RailPresentationContext);
}
