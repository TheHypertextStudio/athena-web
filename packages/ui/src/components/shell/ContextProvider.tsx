'use client';

/**
 * `@docket/ui` — the active-context provider for the app shell.
 *
 * @remarks
 * Holds the workspace's *active context* (the cross-org {@link HUB_CONTEXT} or a specific
 * org id), the layout `density`, and the derived per-org accent color. On every org
 * rebind it recomputes the accent via `getOrgAccent` and the consumer (the
 * {@link AppShell}) applies it as the `--org-accent` CSS variable and a `data-density`
 * attribute, so the active org is always visually unambiguous.
 *
 * State is exposed via {@link useContextState}; entity *labels* are resolved separately
 * through `useVocabulary`.
 */
import * as React from 'react';

import { getOrgAccent } from '../../lib/org-accent';

/** Sentinel value for the cross-org Hub context (no single org bound). */
export const HUB_CONTEXT = 'hub' as const;

/**
 * The active context: either the {@link HUB_CONTEXT} sentinel or a concrete org id.
 *
 * @remarks
 * Both forms are plain strings — compare against {@link HUB_CONTEXT} to distinguish the
 * Hub from a bound org.
 */
export type ActiveContext = string;

/** UI density mode applied to the shell via the `data-density` attribute. */
export type Density = 'comfortable' | 'compact';

/** The shape of the value exposed by {@link useContextState}. */
export interface ContextState {
  /** The active context — {@link HUB_CONTEXT} or an org id. */
  readonly context: ActiveContext;
  /** Whether the Hub (cross-org) context is active. */
  readonly isHub: boolean;
  /** The active org id, or `null` when the Hub is active. */
  readonly activeOrgId: string | null;
  /** The current layout density. */
  readonly density: Density;
  /** The OKLCH accent for the active org, or `null` on the Hub. */
  readonly orgAccent: string | null;
  /** Rebind the active context to the Hub or a specific org id. */
  readonly setContext: (next: ActiveContext) => void;
  /** Update the layout density. */
  readonly setDensity: (next: Density) => void;
}

/** Internal React context; consumed only through {@link useContextState}. */
const ContextStateContext = React.createContext<ContextState | null>(null);

/** Props for {@link ContextProvider}. */
export interface ContextProviderProps {
  /** The initially-active context. Defaults to the {@link HUB_CONTEXT}. */
  initialContext?: ActiveContext;
  /** The initial layout density. Defaults to `comfortable`. */
  initialDensity?: Density;
  /** The subtree that consumes the context state. */
  children: React.ReactNode;
}

/**
 * Provide the active-context, density, and derived org-accent state to the app shell.
 *
 * @remarks
 * The org accent is derived deterministically from the active org id, so it is recomputed
 * (memoized) whenever the context rebinds. On the Hub the accent is `null`.
 */
export function ContextProvider({
  initialContext = HUB_CONTEXT,
  initialDensity = 'comfortable',
  children,
}: ContextProviderProps): React.JSX.Element {
  const [context, setContext] = React.useState<ActiveContext>(initialContext);
  const [density, setDensity] = React.useState<Density>(initialDensity);

  const value = React.useMemo<ContextState>(() => {
    const isHub = context === HUB_CONTEXT;
    const activeOrgId = isHub ? null : context;
    return {
      context,
      isHub,
      activeOrgId,
      density,
      orgAccent: activeOrgId ? getOrgAccent(activeOrgId) : null,
      setContext,
      setDensity,
    };
  }, [context, density]);

  return <ContextStateContext.Provider value={value}>{children}</ContextStateContext.Provider>;
}

/**
 * Read the active-context state.
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
