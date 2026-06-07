'use client';

import type { OrgSummary, VocabularySkin } from '@docket/types';
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { api } from '@/lib/api';

/** The shell-wide org state shared with every authenticated page. */
export interface ActiveOrgValue {
  /** Every org the caller belongs to (drives the rail and org chips). */
  readonly orgs: readonly OrgSummary[];
  /** The org id bound to the current route, or `null` on the Hub. */
  readonly activeOrgId: string | null;
  /** The active org's summary, or `null` on the Hub / before it loads. */
  readonly activeOrg: OrgSummary | null;
  /** The active org's vocabulary skin, or `null` on the Hub / before it loads. */
  readonly skin: VocabularySkin | null;
  /** A non-fatal org-load error to surface, if any. */
  readonly orgsError: string | null;
  /** Resolve an org's display name by id (for org chips), falling back to a short id. */
  readonly orgName: (orgId: string) => string;
}

/** Internal React context; consumed only through {@link useActiveOrg}. */
const ActiveOrgReactContext = createContext<ActiveOrgValue | null>(null);

/** Props for {@link ActiveOrgContext}. */
export interface ActiveOrgContextProps {
  /** Every org the caller belongs to. */
  orgs: readonly OrgSummary[];
  /** The org id bound to the current route, or `null` on the Hub. */
  activeOrgId: string | null;
  /** A non-fatal org-load error to surface, if any. */
  orgsError: string | null;
  /** The subtree that reads the org state via {@link useActiveOrg}. */
  children: ReactNode;
}

/**
 * Provide the shell-wide org list, the active org, and its vocabulary skin to descendants.
 *
 * @remarks
 * Mounted inside the app-shell frame. The rail orgs are compact {@link OrgSummary}s (no
 * vocabulary skin), so when an org is bound this fetches its full {@link OrgOut} once to
 * recover the skin; descendant pages and the sidebar then resolve entity nouns through it.
 * Pages also use {@link ActiveOrgValue.orgName} to label cross-org chips on the Hub.
 */
export function ActiveOrgContext({
  orgs,
  activeOrgId,
  orgsError,
  children,
}: ActiveOrgContextProps): JSX.Element {
  const [skin, setSkin] = useState<VocabularySkin | null>(null);

  // Load the bound org's full record (for its vocabulary skin) whenever it changes.
  useEffect(() => {
    if (!activeOrgId) {
      setSkin(null);
      return;
    }
    const live = { current: true };
    void (async () => {
      const res = await api.v1.orgs[':orgId'].$get({ param: { orgId: activeOrgId } });
      if (!res.ok) return;
      const org = await res.json();
      if (live.current) setSkin(org.vocabulary);
    })();
    return () => {
      live.current = false;
    };
  }, [activeOrgId]);

  const value = useMemo<ActiveOrgValue>(() => {
    const byId = new Map<string, OrgSummary>(orgs.map((o) => [o.id, o]));
    return {
      orgs,
      activeOrgId,
      activeOrg: activeOrgId ? (byId.get(activeOrgId) ?? null) : null,
      skin: activeOrgId ? skin : null,
      orgsError,
      orgName: (orgId: string) => byId.get(orgId)?.name ?? `Org ${orgId.slice(0, 6)}`,
    };
  }, [orgs, activeOrgId, skin, orgsError]);

  return <ActiveOrgReactContext.Provider value={value}>{children}</ActiveOrgReactContext.Provider>;
}

/**
 * Read the shell-wide active-org state.
 *
 * @returns the current {@link ActiveOrgValue}.
 * @throws {Error} when called outside an {@link ActiveOrgContext} (i.e. outside the `(app)` shell).
 */
export function useActiveOrg(): ActiveOrgValue {
  const value = useContext(ActiveOrgReactContext);
  if (value === null) {
    throw new Error('useActiveOrg must be used within the (app) shell.');
  }
  return value;
}
