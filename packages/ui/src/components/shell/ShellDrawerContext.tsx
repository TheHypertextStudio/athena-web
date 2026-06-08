'use client';

/**
 * `@docket/ui` — the shell's mobile-drawer dismissal context.
 *
 * @remarks
 * On small viewports the {@link AppShell} renders the navigation {@link Sidebar} inside an
 * off-canvas drawer (a left {@link Sheet}). Selecting a nav row should both navigate *and* close
 * that drawer so the chosen destination is visible. The {@link Sidebar} is a host-wired node
 * passed into the shell, so it cannot reach into the shell's local drawer state directly — this
 * context bridges that gap: {@link AppShell} provides the dismiss callback around *both* sidebar
 * render slots, and the drawer-rendered {@link Sidebar} reads it via {@link useShellDrawer} to
 * close the drawer on navigation. The static desktop sidebar sits under a `null` provider value,
 * so a nav click there is a no-op (there is no drawer to close).
 */
import * as React from 'react';

/** The dismiss callback the drawer-rendered sidebar calls after a nav selection. */
export type ShellDrawerDismiss = (() => void) | null;

/**
 * Context carrying the active drawer's dismiss callback (or `null` outside a drawer).
 *
 * @remarks
 * Defaults to `null` so a {@link Sidebar} rendered with no provider (e.g. the static desktop
 * rail, or in isolation) treats navigation as a no-op dismissal.
 */
const ShellDrawerContext = React.createContext<ShellDrawerDismiss>(null);

/** Provider wrapping a sidebar render slot with its drawer-dismiss callback. */
export function ShellDrawerProvider({
  dismiss,
  children,
}: {
  /** The dismiss callback for this slot, or `null` for a non-drawer (static) slot. */
  readonly dismiss: ShellDrawerDismiss;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ShellDrawerContext.Provider value={dismiss}>{children}</ShellDrawerContext.Provider>;
}

/**
 * Read the active drawer's dismiss callback (or `null` when not inside a drawer).
 *
 * @returns The dismiss callback to call after a navigation, or `null` if there is no drawer to
 * close (the static desktop sidebar, or a standalone sidebar).
 */
export function useShellDrawer(): ShellDrawerDismiss {
  return React.useContext(ShellDrawerContext);
}
