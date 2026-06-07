'use client';

import type { OrgSummary, TeamOut, VocabularySkin } from '@docket/types';
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

/**
 * The `key` of the org's default ("General") team, seeded at org creation.
 *
 * @remarks
 * Every org is created with exactly one team named "General" with this key (see the
 * org-create transaction in `@docket/api`), so it is the natural default to attach new
 * tasks to. {@link ActiveOrgValue.defaultTeamId} prefers the team carrying this key and
 * falls back to the first team only if a workspace has been re-keyed.
 */
const DEFAULT_TEAM_KEY = 'GEN';

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
  /**
   * The active org's teams, or an empty list on the Hub / before they load.
   *
   * @remarks
   * Fetched from `GET /v1/orgs/:orgId/teams` whenever an org is bound. Used to attach a
   * `teamId` to created tasks and to let callers pick a team when the org has more than one.
   */
  readonly teams: readonly TeamOut[];
  /**
   * The id of the team new work should default to (the "General" team, else the first),
   * or `null` on the Hub / before teams load.
   */
  readonly defaultTeamId: string | null;
  /** Whether the active org's teams are still loading (drives create-affordance disabling). */
  readonly teamsLoading: boolean;
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
 * It also loads the org's teams (`GET /v1/orgs/:orgId/teams`) so every create surface can
 * attach a real `teamId` without the old onboarding-only `sessionStorage` recall — the org's
 * "General" team is exposed as {@link ActiveOrgValue.defaultTeamId}, and the full list lets
 * callers offer a team picker when an org has more than one. Pages also use
 * {@link ActiveOrgValue.orgName} to label cross-org chips on the Hub.
 */
export function ActiveOrgContext({
  orgs,
  activeOrgId,
  orgsError,
  children,
}: ActiveOrgContextProps): JSX.Element {
  const [skin, setSkin] = useState<VocabularySkin | null>(null);
  const [teams, setTeams] = useState<readonly TeamOut[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);

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

  // Load the bound org's teams whenever it changes, so create surfaces have a real teamId.
  useEffect(() => {
    if (!activeOrgId) {
      setTeams([]);
      setTeamsLoading(false);
      return;
    }
    const live = { current: true };
    setTeamsLoading(true);
    void (async () => {
      try {
        const res = await api.v1.orgs[':orgId'].teams.$get({ param: { orgId: activeOrgId } });
        if (!res.ok) {
          if (live.current) setTeams([]);
          return;
        }
        const { items } = await res.json();
        if (live.current) setTeams(items);
      } finally {
        if (live.current) setTeamsLoading(false);
      }
    })();
    return () => {
      live.current = false;
    };
  }, [activeOrgId]);

  const value = useMemo<ActiveOrgValue>(() => {
    const byId = new Map<string, OrgSummary>(orgs.map((o) => [o.id, o]));
    // Prefer the seeded "General" team; fall back to the first team for re-keyed workspaces.
    const defaultTeam = teams.find((t) => t.key === DEFAULT_TEAM_KEY) ?? teams[0] ?? null;
    return {
      orgs,
      activeOrgId,
      activeOrg: activeOrgId ? (byId.get(activeOrgId) ?? null) : null,
      skin: activeOrgId ? skin : null,
      orgsError,
      orgName: (orgId: string) => byId.get(orgId)?.name ?? `Org ${orgId.slice(0, 6)}`,
      teams: activeOrgId ? teams : [],
      defaultTeamId: activeOrgId ? (defaultTeam?.id ?? null) : null,
      teamsLoading: activeOrgId ? teamsLoading : false,
    };
  }, [orgs, activeOrgId, skin, orgsError, teams, teamsLoading]);

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
