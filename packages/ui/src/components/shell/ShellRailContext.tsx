'use client';

/**
 * `@docket/ui` — the shell's rail-collapse context.
 *
 * @remarks
 * The right-hand rail belongs to the shell, because `<main>`'s width depends on it. A surface
 * that needs the room the rail takes, such as a canvas that hosts its own floating panels, asks
 * for the rail to collapse while the surface is mounted. The request holds the rail collapsed
 * without touching the viewer's saved choice; the viewer's own activity-bar click still wins, and
 * releasing the request hands the rail back.
 *
 * Defaults to expanded with a no-op request, so a consumer rendered with no provider (in
 * isolation, or in a test) behaves as if nothing asked.
 */
import * as React from 'react';

/** Whether the shell's rail is collapsed, and how a surface asks for that. */
export interface ShellRailState {
  /** True while the rail is collapsed to zero width, by choice or by request. */
  readonly collapsed: boolean;
  /**
   * Ask for the rail to collapse while a surface needs the room.
   *
   * @returns a release that withdraws the request; call it when the surface unmounts.
   */
  readonly requestCollapsed: () => () => void;
}

const ShellRailContext = React.createContext<ShellRailState>({
  collapsed: false,
  requestCollapsed: () => () => undefined,
});

/** Provider wrapping the shell's content with the rail's collapse state. */
export function ShellRailProvider({
  value,
  children,
}: {
  readonly value: ShellRailState;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ShellRailContext.Provider value={value}>{children}</ShellRailContext.Provider>;
}

/**
 * Read whether the rail is collapsed, and the request for collapsing it.
 *
 * @returns the {@link ShellRailState}; expanded with a no-op request outside a provider.
 */
export function useShellRail(): ShellRailState {
  return React.useContext(ShellRailContext);
}
