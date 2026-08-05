'use client';

/**
 * `@docket/ui` — the shell's sidebar-collapse context.
 *
 * @remarks
 * The {@link Sidebar} is a host-wired node passed into the {@link AppShell}, so it cannot reach the
 * shell's own state directly. This context bridges that gap the same way {@link ShellDrawerContext}
 * does for the mobile drawer: the shell owns whether the sidebar is collapsed (it is the only piece
 * that can, because `<main>`'s width depends on it), and the sidebar reads it.
 *
 * The host's own footer content — an account row, a standing banner — is rendered inside the
 * sidebar, so it reads this too and drops its labels alongside the nav rows rather than being the
 * one thing still demanding 240px.
 *
 * Defaults to expanded with a no-op toggle, so a {@link Sidebar} rendered with no provider (in
 * isolation, or in a test) behaves exactly as it did before this existed.
 */
import * as React from 'react';

/** Whether the shell's sidebar is showing icons only, and how to change that. */
export interface ShellSidebarState {
  /** True while the sidebar is an icon rail rather than a labelled column. */
  readonly collapsed: boolean;
  /** Toggle between the icon rail and the labelled column. */
  readonly onToggle: () => void;
}

const ShellSidebarContext = React.createContext<ShellSidebarState>({
  collapsed: false,
  onToggle: () => undefined,
});

/** Provider wrapping the sidebar render slots with the shell's collapse state. */
export function ShellSidebarProvider({
  value,
  children,
}: {
  readonly value: ShellSidebarState;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ShellSidebarContext.Provider value={value}>{children}</ShellSidebarContext.Provider>;
}

/**
 * Read whether the sidebar is collapsed, and the toggle for it.
 *
 * @returns the {@link ShellSidebarState}; expanded with a no-op toggle outside a provider.
 */
export function useShellSidebar(): ShellSidebarState {
  return React.useContext(ShellSidebarContext);
}
