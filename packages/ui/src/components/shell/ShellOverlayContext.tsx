'use client';

import * as React from 'react';

const ShellOverlayContext = React.createContext<HTMLElement | null>(null);

/** Provide the shell-owned primary-column overlay host to descendant dialogs. */
export function ShellOverlayProvider({
  host,
  children,
}: {
  readonly host: HTMLElement | null;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <ShellOverlayContext.Provider value={host}>{children}</ShellOverlayContext.Provider>;
}

/** Return the overlay host whose bounds exclude the shell's Agenda rail. */
export function useShellOverlayHost(): HTMLElement | null {
  return React.useContext(ShellOverlayContext);
}
