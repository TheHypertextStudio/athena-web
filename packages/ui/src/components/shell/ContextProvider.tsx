'use client';

/**
 * `@docket/ui` — the active-workspace provider for the app shell.
 *
 * @remarks
 * Holds the shell's *active workspace* (the org id whose section the sidebar shows), the
 * layout `density`, and the derived per-org accent color. On every org rebind it recomputes
 * the accent via `getOrgAccent` and the consumer (the {@link AppShell}) applies it as the
 * `--org-accent` CSS variable and a `data-density` attribute, so the active org is always
 * visually unambiguous.
 *
 * There is no cross-org "Hub" mode: the sidebar is a single stable surface whose org-scoped
 * section always reflects the active workspace, even while on a cross-org route (Today/Inbox/
 * Portfolio). The active org id is `null` only before any org has resolved (e.g. a brand-new
 * caller with no orgs yet); in that transient case the accent is omitted.
 *
 * State is exposed via {@link useContextState}; entity *labels* are resolved separately
 * through `useVocabulary`.
 */
import * as React from 'react';

import { getOrgAccent } from '../../lib/org-accent';

/**
 * The active workspace: a concrete org id, or `null` before any org has resolved.
 *
 * @remarks
 * `null` is only the transient pre-resolution state (no orgs loaded yet / a caller with no
 * orgs). Once an org is bound it stays bound, so the sidebar's org section is never empty
 * mid-session.
 */
export type ActiveContext = string | null;

/** UI density mode applied to the shell via the `data-density` attribute. */
export type Density = 'comfortable' | 'compact';

/** The shape of the value exposed by {@link useContextState}. */
export interface ContextState {
  /** The active org id, or `null` before any org has resolved. */
  readonly activeOrgId: string | null;
  /** The current layout density. */
  readonly density: Density;
  /** The OKLCH accent for the active org, or `null` when no org is bound. */
  readonly orgAccent: string | null;
  /** Rebind the active workspace to a specific org id (or `null` before any org resolves). */
  readonly setContext: (next: ActiveContext) => void;
  /** Update the layout density. */
  readonly setDensity: (next: Density) => void;
}

/** Internal React context; consumed only through {@link useContextState}. */
const ContextStateContext = React.createContext<ContextState | null>(null);

/** Props for {@link ContextProvider}. */
export interface ContextProviderProps {
  /** The initially-active org id. Defaults to `null` (no org resolved yet). */
  initialContext?: ActiveContext;
  /** The initial layout density. Defaults to `comfortable`. */
  initialDensity?: Density;
  /** The subtree that consumes the context state. */
  children: React.ReactNode;
}

/**
 * Provide the active-workspace, density, and derived org-accent state to the app shell.
 *
 * @remarks
 * The org accent is derived deterministically from the active org id, so it is recomputed
 * (memoized) whenever the workspace rebinds. When no org is bound the accent is `null`.
 */
export function ContextProvider({
  initialContext = null,
  initialDensity = 'comfortable',
  children,
}: ContextProviderProps): React.JSX.Element {
  const [context, setContext] = React.useState<ActiveContext>(initialContext);
  const [density, setDensity] = React.useState<Density>(initialDensity);

  const value = React.useMemo<ContextState>(
    () => ({
      activeOrgId: context,
      density,
      orgAccent: context ? getOrgAccent(context) : null,
      setContext,
      setDensity,
    }),
    [context, density],
  );

  return <ContextStateContext.Provider value={value}>{children}</ContextStateContext.Provider>;
}

/**
 * Read the active-workspace state.
 *
 * @returns the current {@link ContextState}.
 * @throws {Error} when called outside a {@link ContextProvider}.
 */
export function useContextState(): ContextState {
  const value = React.useContext(ContextStateContext);
  if (value === null) {
    throw new Error('useContextState must be used within a <ContextProvider>.');
  }
  return value;
}
