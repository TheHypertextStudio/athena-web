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

const RailSheetBarSlotContext = React.createContext<HTMLElement | null>(null);

/** Props for {@link RailSheetBarSlotProvider}. */
export interface RailSheetBarSlotProviderProps {
  /** The element in the sheet's title bar a panel may portal its own header controls into. */
  readonly slot: HTMLElement | null;
  readonly children: React.ReactNode;
}

/**
 * Provider for the sheet title bar's trailing slot.
 *
 * @remarks
 * The sheet's title bar already holds the panel switcher and the close button. A panel whose own
 * header carries controls (a page chip, Talk, a link out) portals them into this slot while the
 * sheet hosts it, so the compact width paints one header row instead of the bar plus a second,
 * mostly empty row of the panel's own.
 */
export function RailSheetBarSlotProvider({
  slot,
  children,
}: RailSheetBarSlotProviderProps): React.JSX.Element {
  return (
    <RailSheetBarSlotContext.Provider value={slot}>{children}</RailSheetBarSlotContext.Provider>
  );
}

/**
 * Read the sheet title bar's trailing slot.
 *
 * @returns the slot element while the mobile sheet hosts the calling panel, else `null`.
 */
export function useRailSheetBarSlot(): HTMLElement | null {
  return React.useContext(RailSheetBarSlotContext);
}
