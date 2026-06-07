'use client';

import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/** A persisted record of the currently-active "viewing as" impersonation session. */
export interface ActiveImpersonation {
  /** The impersonation-session id returned by `POST /v1/admin/impersonations`. */
  id: string;
  /** The id of the user being viewed as. */
  targetUserId: string;
  /** A display label for the target (name or email), shown in the banner. */
  targetLabel: string;
  /** When the session expires (ISO-8601), surfaced in the banner. */
  expiresAt: string;
}

/** The impersonation context value: the active session and its mutators. */
export interface ImpersonationContextValue {
  /** The active impersonation, or `null` when none is in progress. */
  active: ActiveImpersonation | null;
  /** Record a freshly-started impersonation as the active session. */
  start: (session: ActiveImpersonation) => void;
  /** Clear the active session (after it is ended server-side). */
  clear: () => void;
}

/** The browser storage key under which the active impersonation is persisted. */
const STORAGE_KEY = 'docket.admin.impersonation';

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null);

/** Read the persisted impersonation from `localStorage`, tolerating absent/corrupt data. */
function readStored(): ActiveImpersonation | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveImpersonation;
  } catch {
    return null;
  }
}

/** Props for {@link ImpersonationProvider}. */
export interface ImpersonationProviderProps {
  /** The subtree that can read and mutate the active impersonation. */
  children: ReactNode;
}

/**
 * Provider tracking the operator's active "viewing as" impersonation session.
 *
 * @remarks
 * The active session is persisted to `localStorage` so the persistent banner survives
 * navigation and reloads. It is hydrated lazily after mount (never during SSR) to avoid a
 * hydration mismatch. Screens call {@link ImpersonationContextValue.start} after a
 * successful `POST /v1/admin/impersonations` and {@link ImpersonationContextValue.clear}
 * after ending the session.
 */
export function ImpersonationProvider({ children }: ImpersonationProviderProps): JSX.Element {
  const [active, setActive] = useState<ActiveImpersonation | null>(null);

  useEffect(() => {
    setActive(readStored());
  }, []);

  const start = useCallback((session: ActiveImpersonation) => {
    setActive(session);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, []);

  const clear = useCallback(() => {
    setActive(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo<ImpersonationContextValue>(
    () => ({ active, start, clear }),
    [active, start, clear],
  );

  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>;
}

/**
 * Read the impersonation context.
 *
 * @returns the active "viewing as" session and its `start`/`clear` mutators.
 * @throws {Error} when called outside an {@link ImpersonationProvider}.
 */
export function useImpersonation(): ImpersonationContextValue {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error('useImpersonation must be used within an ImpersonationProvider');
  return ctx;
}
