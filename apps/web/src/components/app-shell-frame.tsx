'use client';

import {
  AppShell,
  type AppShellAside,
  ContextProvider,
  type HomeNavKey,
  IdentityGlyph,
  type OpenTab,
  PageScrollProvider,
  type RailPanel,
  Sidebar,
  TabBar,
  useContextState,
  useShellSidebar,
  type Workspace,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import { defaultEntityDisplay, type EntityDisplaySubjectType } from '@docket/types';
import { VocabularyProvider } from '@docket/ui/hooks';
import {
  Calendar,
  GanttChart,
  RefreshCw,
  Search,
  Sparkles,
  TaskAlt,
  Timer,
} from '@docket/ui/icons';
import { Skeleton, Stack } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useAppPathname } from '@/lib/app-location';
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import AccountMenu, { type AccountMenuIdentity } from '@/components/account-menu';
import { ActiveOrgContext, useActiveOrg } from '@/components/active-org';
import {
  CreateObjectProvider,
  CreationDestinationProvider,
} from '@/components/create-object/create-object-provider';
import { GlobalInitiativeComposer } from '@/components/initiatives/create-initiative';
import { GlobalProgramComposer } from '@/components/programs/create-program';
import { GlobalProjectComposer } from '@/components/projects/create-project';
import { GlobalTaskComposer } from '@/components/tasks/create-task';
import { GlobalTeamComposer } from '@/components/teams/create-team';
import Agenda from '@/components/agenda/agenda';
import {
  AthenaPanelProvider,
  AthenaRailPanel,
  useAthenaPanel,
} from '@/components/athena/athena-panel-provider';
import { useAuthenticationInterlock } from '@/components/authentication-interlock';
import { BillingRecovery } from '@/components/billing/billing-recovery';
import {
  CommandPaletteHost,
  CommandPaletteProvider,
  useCommandPalette,
} from '@/components/command-palette';
import { OfflineBanner, OfflineContent } from '@/components/offline-state';
import { NavigationProgress } from '@/components/navigation-progress';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { OfflineSyncIndicator, OfflineSyncRuntime, useOutboxSummary } from '@/components/pwa';
import { waitForOutboxSessionTransition } from '@/components/pwa/outbox';
import { purgeOfflineDocuments } from '@/components/pwa/purge-offline-documents';
import { NavigationSnapshotPersistence } from '@/components/navigation-snapshot-persistence';
import { ReachabilityProvider } from '@/components/reachability';
import { RecoveryNudgeBanner } from '@/components/recovery-nudge-banner';
import { ResolvedAccountProvider } from '@/components/resolved-account';
import { SessionSnapshotPersistence } from '@/components/session-snapshot-persistence';
import { SettingsShell } from '@/components/settings/settings-shell';
import { UpdateCard, useServiceWorkerUpdate } from '@/components/service-worker-provider';
import { OpenDocumentsProvider, useOpenDocuments } from '@/components/tabs';
import {
  FocusPanel,
  focusRailStatus,
  type TimerStatus,
  useTimerStatus,
} from '@/components/time-tracking';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import { purgeAllNavigationSnapshots } from '@/lib/navigation-snapshot-runtime';
import { STALE, apiQueryOptions, queryKeys, useApiQuery, useLiveApiQuery } from '@/lib/query';
import { clearSessionSnapshot, readSessionSnapshot } from '@/lib/session-snapshot';
// Type-only: `server-session.ts` reaches for `next/headers`, so a value import would drag a
// server-only module into this `'use client'` boundary. The type is erased at compile time.
import type { ServerSessionUser } from '@/lib/server-session';
import { resolveSessionStatus } from '@/lib/session-status';
import { useOnlineStatus } from '@/lib/use-online-status';
import { CREATE_WORKSPACE_PATH } from '@/lib/workspace-creation';
import { athenaHref } from '@/lib/athena/query-defs';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';

/**
 * How long the session query may stay pending before the shell treats the server as unreachable.
 *
 * @remarks
 * Only reached when a request hangs instead of failing — a captive portal that completes the TCP
 * handshake and then never responds. Eight seconds is past any plausible cold start on a slow
 * connection, so a healthy-but-sluggish load still resolves normally and keeps its loading
 * treatment rather than being misreported as offline.
 */
const SESSION_PEND_BUDGET_MS = 8_000;

import {
  homeKeyFromPath,
  orgIdFromPath,
  readDensity,
  readLastOrg,
  renderLink,
  resolveActiveOrg,
  workspaceKeyFromPath,
  writeDensity,
  writeLastOrg,
} from './app-shell-utils';

/** Props for {@link AppShellFrame}. */
export interface AppShellFrameProps {
  /** The active page, rendered inside the shell's `<main>`. */
  readonly children: ReactNode;
  /**
   * The server-confirmed identity for this request, or `null` when the server read was `'unknown'`.
   *
   * @remarks
   * Required rather than optional, deliberately. The `(app)` layout already resolved who this is
   * before the document was sent, so the shell has no reason to ask again before it can draw an
   * account row or a workspace name — and a caller that simply forgot to pass it would silently
   * reintroduce the identity skeleton on every entry. Making it required forces the omission to be
   * an explicit `null`, which means "the server could not ask", not "nobody bothered".
   *
   * `null` never implies signed-out. Only the client session resolving to *no session* does, and
   * only that opens the interlock.
   */
  readonly initialSession: ServerSessionUser | null;
}

/**
 * The authenticated app-shell frame: the single flattened sidebar, the multi-document tab bar,
 * and the active workspace.
 *
 * @remarks
 * Mounted by the `(app)` route-group layout so every authenticated page shares one shell.
 * It gates access on the Better Auth session (opening the blocking sign-in interlock when signed
 * out) and
 * loads the caller's orgs once for the {@link Sidebar}'s workspace switcher. There is no
 * cross-org "Hub" mode that swaps the sidebar: the sidebar's Workspace section always reflects
 * the active workspace, resolved as route org ?? persisted last-used ?? personal space.
 *
 * The orgs and the bound org's vocabulary skin are exposed to descendant pages through
 * {@link useActiveOrg} so they can render org chips and resolve entity nouns without refetching.
 *
 * **The shell never withholds statically-known chrome, or the page's own content, behind a data
 * fetch.** The navigation labels, the tab bar, the mobile search control and every page's heading
 * and toolbar are compile-time constants or route-derived, so they paint on the first frame. What a
 * fetch can legitimately gate is narrow and is tracked by exactly two flags:
 *
 * - {@link identityUnknown} — no live session, no `initialSession`, and no offline snapshot. Only
 *   this may stand in for the account row and the rail's identity-bound panels.
 * - {@link workspacesUnknown} — the org list has not arrived. Only this may stand in for the
 *   workspace switcher's *name* and its list of workspaces to switch between.
 *
 * Nothing else is gated by either. An earlier version collapsed both into one `shellLoading` flag
 * that also gated `children`, the tab bar, the mobile search button and the whole Workspace nav,
 * which cost a statically-known page heading ~420ms on every entry and put four grey bars where the
 * words "Initiatives / Programs / Projects / Cycles" already belonged. Each page owns an in-region
 * loading treatment for its own data; the shell adds nothing by blocking on top of it.
 */
export function AppShellFrame({ children, initialSession }: AppShellFrameProps): JSX.Element {
  const pathname = useAppPathname();
  const { data: session, isPending, error: sessionError, refetch } = authClient.useSession();
  const { requireAuthentication } = useAuthenticationInterlock();
  const online = useOnlineStatus();

  // A request that hangs rather than fails (captive portal) never flips `isPending`, so give the
  // pend a deadline and treat an overrun as unreachable. Reset whenever the query restarts.
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  useEffect(() => {
    if (!isPending) {
      setPendingTimedOut(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setPendingTimedOut(true);
    }, SESSION_PEND_BUDGET_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPending]);

  const status = resolveSessionStatus({
    hasSession: Boolean(session),
    isPending,
    hasError: sessionError !== null,
    pendingTimedOut,
  });

  // Only a server-confirmed "no session" may interrupt. An unreachable server means we simply do
  // not know, and shoving a non-dismissible sign-in dialog at someone who is merely offline —
  // with a perfectly valid session — is the failure this branch exists to prevent.
  useEffect(() => {
    if (status === 'signed-out') {
      clearSessionSnapshot();
      requireAuthentication(`${pathname}${window.location.search}`);
    }
  }, [status, pathname, requireAuthentication]);

  // Read once per unreachable episode rather than on every render, so the offline shell does not
  // re-resolve identity mid-session.
  const [snapshot] = useState(() => readSessionSnapshot(Date.now()));

  // The snapshot stands in for the live session ONLY while the server is unreachable. Every other
  // status ignores it, so it can never keep a signed-out person inside the shell.
  const offlineIdentity = status === 'unreachable' ? snapshot : null;
  const userId = session?.user.id ?? initialSession?.userId ?? offlineIdentity?.userId ?? null;

  // A QueryClient key does not contain the account id. Hold private rendering when the resolved
  // identity changes, clear every account-neutral memory entry before paint, and release the next
  // account only after all persisted identity artifacts have finished deleting. The initial value
  // includes the disk snapshot so a cold B entry on a browser last used by A is gated too.
  const queryClient = useQueryClient();
  const [renderedUserId, setRenderedUserId] = useState<string | null>(
    () => snapshot?.userId ?? userId,
  );
  const identitySwitching = renderedUserId !== userId;
  useLayoutEffect(() => {
    if (!identitySwitching) return undefined;
    let current = true;
    queryClient.clear();
    clearSessionSnapshot();
    void Promise.all([
      waitForOutboxSessionTransition(),
      purgeAllNavigationSnapshots(),
      purgeOfflineDocuments(),
    ]).then(() => {
      if (current) setRenderedUserId(userId);
    });
    return () => {
      current = false;
    };
  }, [identitySwitching, queryClient, userId]);

  // Re-ask ONLY on the offline -> online edge, never on `status`.
  //
  // An earlier version refetched whenever `status === 'unreachable'`, which was a self-inflicted
  // request storm: the refetch failed, status returned to `unreachable`, and the effect fired
  // again — measured at ~2,060 requests to `/api/auth/get-session` in 15 seconds against a server
  // that was merely returning 500. It also meant `isPending` never settled, so the shell could
  // never reach a terminal state and sat on its loading treatment indefinitely.
  //
  // Better Auth's own online manager already refetches on reconnect, so this is only a backstop for
  // the captive-portal case where no `offline` event ever fired. Everything else is the explicit
  // retry control.
  const wasOnlineRef = useRef(online);
  useEffect(() => {
    const cameBackOnline = online && !wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (cameBackOnline) void refetch();
  }, [online, refetch]);

  // The caller's orgs drive the sidebar's workspace switcher — read once through the shared query
  // layer and gated on a known identity. The frame itself stays mounted while this settles.
  //
  // A server-confirmed `initialSession` is enough to start it: the `(app)` layout already
  // prefetched this exact key into the hydration boundary, so in the normal case the data is
  // present on the first client render and this never fetches at all. Waiting for the client
  // session to echo back an identity the server already resolved would only delay the workspace
  // name by a round trip.
  const orgsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.orgs(),
      () => api.v1.orgs.$get(),
      'Could not load your organizations.',
      {
        enabled: !identitySwitching && (Boolean(session) || Boolean(initialSession)),
        staleTime: STALE.static,
      },
    ),
  );
  const orgs = useMemo(
    () => (identitySwitching ? [] : (orgsQ.data?.items ?? [])),
    [identitySwitching, orgsQ.data],
  );
  const orgsError = orgsQ.error
    ? userErrorMessage(orgsQ.error, 'Could not load your workspaces.')
    : null;

  // One identity source feeds every identity-bound shell region, including the account row. The
  // old account row started its own Better Auth hook, so a server-confirmed initial session could
  // render no row on the server and a populated row on the first client pass. That duplicate read
  // was the Account menu hydration mismatch captured during the switcher audit.
  const accountIdentity: AccountMenuIdentity | null = session
    ? {
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
      }
    : (initialSession ?? offlineIdentity);

  const routeOrgId = orgIdFromPath(pathname);

  // We do not know who this is: no live session, no server-confirmed identity, no cached snapshot.
  // The ONLY thing this may gate is identity-bound chrome (the account row and the rail's
  // identity-bound panels). With the layout's server-side guard in place it is false on essentially
  // every real entry, so those fallbacks are now genuinely-unknown-only rather than the default.
  const identityUnknown = identitySwitching || (!session && !initialSession && !offlineIdentity);

  // The workspace list has not arrived. The ONLY thing this may gate is the switcher's workspace
  // name and its list — never a nav label, which is a compile-time constant.
  //
  // Offline, `orgsQ` is disabled and will never settle, so gating on it would pin the switcher to
  // its loading treatment forever. Anything the query layer has cached still renders; the rest
  // degrades to empty, with the offline banner explaining why.
  const workspacesUnknown = identitySwitching || (offlineIdentity ? false : orgsQ.isPending);

  // The server answered, definitively, that there is no session. This is an authorization decision,
  // not a loading state: the interlock is opening over the shell, and painting a page's private
  // content behind it would show data the viewer is no longer entitled to. Distinct from every
  // "still resolving" case, all of which now render the page.
  const sessionRejected = status === 'signed-out' || identitySwitching;

  // Unreachable with no cached identity: there is no workspace to populate, but that is NOT a
  // reason to replace the application with an error page. The shell's chrome — navigation, the
  // settings information architecture, the command palette's navigate actions — is static and
  // works perfectly well without a network, so it stays. Only the content region degrades, via
  // `unavailable` below. Anything that renders a wall here throws away everything that still works.
  const unavailable = status === 'unreachable' && !offlineIdentity;

  const settingsSurface =
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname.endsWith('/settings') ||
    pathname.includes('/settings/');
  // The calendar surface (`/calendar` or `/orgs/<id>/calendar`) owns the whole scheduling width.
  // A right rail makes a week collapse into a few narrow day lanes, which turns the surface into a
  // cramped agenda before the person has chosen that presentation.
  // `(^|/)calendar$` excludes settings' `google-calendar` (preceded by `-`, not `/`).
  const calendarSurface = /(^|\/)calendar$/.test(pathname);

  // Bind the active workspace during render, from the route and the layout-hydrated workspace list.
  // Doing it here rather than only in `AppShellInner`'s effect is what lets the Workspace rows be
  // real links on the very first paint; when this was effect-only the rows spent ~350ms rendered
  // inert and visibly dimmed while an effect caught up with data that was already in hand.
  //
  // `readLastOrg` is deliberately NOT consulted here. It reads `localStorage`, which the server
  // render cannot see, so seeding from it would make the server and the first client render
  // disagree about every Workspace href — a hydration mismatch. The persisted preference is a
  // refinement, and `AppShellInner`'s effect applies it.
  const initialOrgId = routeOrgId ?? resolveActiveOrg(null, orgs, null);
  const renderedAccountIdentity = identitySwitching ? null : accountIdentity;
  const renderedStorageUserId = identitySwitching ? null : userId;

  return (
    <ContextProvider initialContext={initialOrgId} initialDensity={readDensity(userId)}>
      {/* Published to the whole tree so a link can tell whether navigating will reach anything.
          `status` is the shell's own answer and is strictly better than `navigator.onLine`, which
          is true behind a captive portal and true when the server itself is down. */}
      <ReachabilityProvider reachable={status !== 'unreachable'}>
        <ActiveOrgContext
          orgs={orgs}
          activeOrgId={routeOrgId}
          orgsError={orgsError}
          orgsLoading={workspacesUnknown}
        >
          {/* Creation state belongs above the palette so commands and page launchers converge on
            one request. Kind-specific bodies are mounted into this seam as they migrate. */}
          <CreateObjectProvider>
            {/* The palette's navigate actions are static route pushes, so it is armed as soon as we
              know whose workspace to search — not once every workspace has loaded. */}
            <CommandPaletteProvider enabled={!identityUnknown}>
              <NavigationSnapshotPersistence userId={userId} />
              {/* This is the first place that durable local state can bind to a resolved account. */}
              <OfflineSyncRuntime userId={userId} />
              <SessionSnapshotPersistence
                identity={
                  status === 'authenticated' && session
                    ? {
                        userId: session.user.id,
                        name: session.user.name,
                        email: session.user.email,
                        image: session.user.image ?? null,
                      }
                    : null
                }
              />
              <ResolvedAccountProvider userId={renderedStorageUserId}>
                <OpenDocumentsProvider userId={renderedStorageUserId}>
                  <AppShellInner
                    accountIdentity={renderedAccountIdentity}
                    identityUnknown={identityUnknown}
                    workspacesUnknown={workspacesUnknown}
                    sessionRejected={sessionRejected}
                    settingsSurface={settingsSurface}
                    calendarSurface={calendarSurface}
                    locationKey={pathname}
                    routeOrgId={routeOrgId}
                    userId={renderedStorageUserId}
                    offline={
                      status === 'unreachable'
                        ? {
                            online,
                            onRetry: () => {
                              void refetch();
                            },
                          }
                        : null
                    }
                    unavailable={unavailable}
                    workspaceKey={workspaceKeyFromPath(pathname)}
                    homeKey={homeKeyFromPath(pathname)}
                  >
                    {children}
                  </AppShellInner>
                </OpenDocumentsProvider>
              </ResolvedAccountProvider>
            </CommandPaletteProvider>
          </CreateObjectProvider>
        </ActiveOrgContext>
      </ReachabilityProvider>
    </ContextProvider>
  );
}

/**
 * Inert account-area placeholder, shown only while the viewer's identity is genuinely unknown.
 *
 * @remarks
 * Rendered when there is no live session, no server-confirmed `initialSession` and no offline
 * snapshot — i.e. nobody can say whose name and avatar belong here. Every one of those three
 * sources is absent only on a cold entry that bypassed the layout's server-side session read, so in
 * practice this is a fallback rather than a first-paint treatment.
 */
function AppShellAccountSkeleton(): JSX.Element {
  return (
    // placeholder: the signed-in account's name, email and avatar — unknown until a session resolves
    <div className="flex items-center gap-2 px-2 py-2" aria-hidden="true">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-24 rounded" />
        <Skeleton className="h-3 w-32 rounded" />
      </div>
    </div>
  );
}

/**
 * Rail placeholder used while the viewer's identity is unknown.
 *
 * @remarks
 * The Agenda and the Tasks day-plan are both per-person reads keyed by the signed-in user, so
 * neither can be mounted before there is a user to key them by. Gated on identity alone — never on
 * the workspace list, which the rail does not need.
 */
function AppShellAgendaSkeleton(): JSX.Element {
  return (
    // placeholder: the signed-in person's agenda and day plan — per-user reads with no viewer yet
    <div className="flex flex-col gap-4 p-4" aria-hidden="true">
      <Skeleton className="h-5 w-20 rounded" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

/**
 * The recovery nudge, withheld while the sidebar is an icon rail.
 *
 * @remarks
 * The banner is prose, and prose has no collapsed form — truncating it would leave something nobody
 * can act on, and a 56px column cannot hold it. It is a nudge rather than a blocker, so deferring it
 * until the nav is expanded costs only time.
 *
 * Split into its own component because the shell's collapse state lives in a context that
 * {@link AppShell} provides *around* the sidebar node — a caller assembling that node cannot read it,
 * but anything rendered inside it can.
 */
/**
 * The update prompt, docked above the account row. Hidden while the rail is collapsed for the
 * same reason as the recovery nudge: an icon-wide rail has no room for a card, and an update can
 * wait until the rail is open.
 */
function SidebarUpdateCard({ onApply }: { readonly onApply: () => void }): JSX.Element | null {
  const { collapsed } = useShellSidebar();
  if (collapsed) return null;
  return <UpdateCard onApply={onApply} />;
}

function SidebarRecoveryNudge({
  personalOrgId,
  userId,
}: {
  readonly personalOrgId: string | null;
  readonly userId: string | null;
}): JSX.Element | null {
  const { collapsed } = useShellSidebar();
  if (collapsed) return null;
  return <RecoveryNudgeBanner personalOrgId={personalOrgId} userId={userId} />;
}

/**
 * The curated, Docket-native rail panels for a non-calendar surface. Internal-only by design — the
 * Tasks day-plan and the Agenda — never an integration add-on gallery.
 *
 * @remarks
 * The calendar does not use this rail. Its own timeline is the primary planning surface, and a
 * docked companion steals enough width to hide a normal seven-day week. Calendar creation keeps an
 * explicit Event/Timebox choice, while task management stays one navigation action away.
 *
 * Every panel here is a per-person read, so they are swapped for a placeholder on
 * `identityUnknown` alone. The workspace list is irrelevant to all of them — gating them on it
 * would have held an empty rail open for an org fetch no panel consumes.
 *
 * @param identityUnknown - Whether the viewer is still unidentified; swaps panels for a placeholder.
 * @param timerStatus - The live tracker, which lends the Focus icon its status dot.
 * @returns The rail panel set and the panel shown until the viewer picks another.
 */
function railAsideFor(
  identityUnknown: boolean,
  timerStatus: TimerStatus,
  athena: RailPanel,
): AppShellAside {
  const status = identityUnknown ? null : focusRailStatus(timerStatus);
  const focus: RailPanel = {
    id: 'focus',
    label: 'Focus',
    icon: <Timer aria-hidden="true" />,
    node: identityUnknown ? <AppShellAgendaSkeleton /> : <FocusPanel />,
    ...(status ? { status } : {}),
  };
  const agenda: RailPanel = {
    id: 'agenda',
    label: 'Agenda',
    icon: <Calendar aria-hidden="true" />,
    node: identityUnknown ? <AppShellAgendaSkeleton /> : <Agenda />,
  };
  return { panels: [agenda, focus, athena], defaultPanelId: 'agenda' };
}

interface AppShellInnerProps {
  /** Display identity resolved by the outer session boundary, or `null` while genuinely unknown. */
  accountIdentity: AccountMenuIdentity | null;
  /**
   * No live session, no server-confirmed identity, and no offline snapshot. Gates the account row
   * and the rail's per-person panels — and nothing else.
   */
  identityUnknown: boolean;
  /**
   * The caller's workspace list has not arrived. Gates the workspace switcher's name and list —
   * and nothing else. Never a nav label, a heading, the tab bar or the page's content.
   */
  workspacesUnknown: boolean;
  /**
   * The session query settled with *no session*. Withholds the page's private content while the
   * interlock opens over the shell. An authorization decision, never a loading state.
   */
  sessionRejected: boolean;
  settingsSurface: boolean;
  calendarSurface: boolean;
  locationKey: string;
  routeOrgId: string | null;
  userId: string | null;
  /**
   * Set while the shell is rendering from a cached identity because the server is unreachable.
   * Drives the standing offline banner; `null` whenever the session is live.
   */
  offline: { readonly online: boolean; readonly onRetry: () => void } | null;
  /**
   * Set when the server is unreachable AND there is no cached identity, so there is nothing to
   * populate the content region with. Degrades `<main>` only — the surrounding chrome stays live.
   */
  unavailable: boolean;
  workspaceKey?: WorkspaceNavKey | undefined;
  homeKey?: HomeNavKey | undefined;
  children: ReactNode;
}

interface SavedRecentEntityIdentityProps {
  readonly subjectType: Extract<EntityDisplaySubjectType, 'initiative' | 'project'>;
  readonly orgId: string;
  readonly subjectId: string;
}

const FIXED_RECENT_DOCUMENT_ICON = {
  task: TaskAlt,
  cycle: RefreshCw,
  session: GanttChart,
} as const;

/** Render one saved Project or Initiative identity through the same glyph as its detail page. */
function SavedRecentEntityIdentity({
  subjectType,
  orgId,
  subjectId,
}: SavedRecentEntityIdentityProps): JSX.Element {
  const displayQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplay(orgId, subjectType, subjectId),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
          param: { orgId, subjectType, subjectId },
        }),
      'Could not load the recent item icon.',
      { staleTime: STALE.static },
    ),
  );
  const display = displayQ.data ?? defaultEntityDisplay(subjectType, subjectId);

  return (
    <EntityIconGlyph
      iconKey={display.iconKey}
      colorKey={display.colorKey}
      customColor={display.customColor}
      size={32}
    />
  );
}

/** Render the detail-page identity that belongs to one recent document. */
export function RecentDocumentIdentity({ document }: { readonly document: OpenTab }): JSX.Element {
  if (document.type === 'initiative' || document.type === 'project') {
    return (
      <SavedRecentEntityIdentity
        subjectType={document.type}
        orgId={document.orgId}
        subjectId={document.id}
      />
    );
  }
  if (document.type === 'program') {
    return <EntityIconGlyph iconKey="layers" colorKey="primary" customColor={null} size={32} />;
  }

  const Icon = FIXED_RECENT_DOCUMENT_ICON[document.type];
  return (
    <IdentityGlyph size={32} className="[&_svg]:size-4!">
      <Icon aria-hidden="true" />
    </IdentityGlyph>
  );
}

/**
 * The shell body that lives inside the providers and wires shell selections to navigation.
 *
 * @remarks
 * Split from {@link AppShellFrame} because it must read the shell context, active-org state,
 * and open-documents store (only available inside their providers). The flattened sidebar
 * always shows both sections — the cross-org Home section and the active workspace's section —
 * so the active workspace is resolved as route org ?? persisted last-used ?? personal space and
 * mirrored into the shell context (driving the org accent + the Workspace section's hrefs).
 */
function AppShellInner({
  accountIdentity,
  identityUnknown,
  workspacesUnknown,
  sessionRejected,
  settingsSurface,
  calendarSurface,
  locationKey,
  routeOrgId,
  userId,
  offline,
  unavailable,
  workspaceKey,
  homeKey,
  children,
}: AppShellInnerProps): JSX.Element {
  const router = useRouter();
  const { setContext, setDensity, density } = useContextState();
  const { orgs, skin } = useActiveOrg();
  const { openPalette } = useCommandPalette();
  const { tabs, recentDocuments, activeKey, closeTab } = useOpenDocuments();

  // Registration itself lives at the root so it happens on every route; the shell only consumes
  // the result, docking the update card at the bottom of the sidebar.
  const { applyUpdate } = useServiceWorkerUpdate();

  // The tickless read, never `useTimerState`. The Focus panel owns the once-a-second clock; a
  // shell that subscribed to it would re-render the entire application every second a timer ran.
  // This one changes only when the timer actually starts, pauses, resumes or stops.
  const timerStatus = useTimerStatus();

  // Queued offline writes are a standing fact about this session, not a property of any route, so
  // the shell owns the disclosure the same way it owns the offline and update notices.
  const outbox = useOutboxSummary();
  const hasQueuedWork = outbox.pending > 0 || outbox.stalled > 0;
  const standingNotice =
    offline && !unavailable ? (
      <OfflineBanner online={offline.online} onRetry={offline.onRetry} />
    ) : null;

  // The sidebar's unread badge polls on a focus-only minute interval, sharing the inbox's
  // notifications-count cache (queryKeys.notificationsCount()) so the two stay in lock-step.
  const unreadCountQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.notificationsCount(),
      () => api.v1.notifications.count.$get(),
      'Could not load notifications.',
      { enabled: !identityUnknown, staleTime: STALE.volatile },
    ),
    60_000,
  );
  const unreadCount = unreadCountQ.data?.unread ?? 0;

  useEffect(() => {
    if (userId) setDensity(readDensity(userId));
  }, [setDensity, userId]);

  useEffect(() => {
    if (userId) writeDensity(userId, density);
  }, [density, userId]);

  const workspaces = useMemo<readonly Workspace[]>(
    () =>
      orgs.map((o) => ({
        id: o.id,
        name: o.name,
        avatar: o.avatar,
      })),
    [orgs],
  );

  const [lastOrgId, setLastOrgId] = useState<string | null>(() => readLastOrg(userId));
  useEffect(() => {
    setLastOrgId(readLastOrg(userId));
  }, [userId]);

  const resolvedOrgId = useMemo(
    () => resolveActiveOrg(routeOrgId, orgs, lastOrgId),
    [routeOrgId, orgs, lastOrgId],
  );

  const resolvedOrgIsPersonal = useMemo(
    () => orgs.find((o) => o.id === resolvedOrgId)?.isPersonal ?? false,
    [orgs, resolvedOrgId],
  );

  const personalOrgId = useMemo(() => orgs.find((o) => o.isPersonal)?.id ?? null, [orgs]);

  // The personal org owns the account-level Security settings the recovery-codes nudge links to.

  // Bind the resolved workspace as soon as one exists, and never unbind it. The context was
  // previously cleared to `null` on every loading tick, which is what forced the Workspace nav
  // through an "unknown workspace" state on each entry even when the route already named the org.
  // Once a workspace is bound it stays bound; `resolveActiveOrg` returns the route's org whenever
  // the route has one, so a real navigation still rebinds immediately.
  useEffect(() => {
    if (resolvedOrgId) setContext(resolvedOrgId);
  }, [resolvedOrgId, setContext]);

  useEffect(() => {
    if (resolvedOrgId) writeLastOrg(userId, resolvedOrgId);
  }, [resolvedOrgId, userId]);

  const onSelectWorkspace = useCallback(
    (orgId: string): void => {
      setContext(orgId);
      writeLastOrg(userId, orgId);
      router.push(`/orgs/${orgId}/my-work`);
    },
    [router, setContext, userId],
  );

  /** Open the one shared repeat-workspace creation route from any shell launcher. */
  const onCreateWorkspace = useCallback((): void => {
    router.push(CREATE_WORKSPACE_PATH);
  }, [router]);

  const sidebar = (
    <Sidebar
      // The sidebar's only unknown-until-fetch value is the workspace *name* and the list to switch
      // between; its nav labels are compile-time constants and render regardless.
      loading={workspacesUnknown}
      workspaces={workspaces}
      activeHomeKey={homeKey}
      activeWorkspaceKey={workspaceKey}
      unreadCount={unreadCount}
      recentDocuments={recentDocuments}
      activeDocumentKey={activeKey}
      renderRecentDocumentIcon={(document) => <RecentDocumentIdentity document={document} />}
      hrefForHome={(key) => `/${key}`}
      hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
      renderLink={renderLink}
      onSelectWorkspace={onSelectWorkspace}
      onCreateWorkspace={onCreateWorkspace}
      onOpenSearch={openPalette}
      personalWorkspace={resolvedOrgIsPersonal}
      footer={
        identityUnknown || !accountIdentity ? (
          <AppShellAccountSkeleton />
        ) : (
          // A real gap between every footer card, including the account row — the recovery nudge
          // and update card previously relied on their own bottom margin, which left them flush
          // against whichever card came before them.
          <div className="flex flex-col gap-2">
            <SidebarRecoveryNudge personalOrgId={personalOrgId} userId={userId} />
            {applyUpdate ? <SidebarUpdateCard onApply={applyUpdate} /> : null}
            <AccountMenu identity={accountIdentity} onCreateWorkspace={onCreateWorkspace} />
          </div>
        )
      }
    />
  );

  // An empty document collection has no tab row. Passing `null` is intentional: the desktop rail
  // needs to reserve the shared 40px tab block only when this is a visible row, not when a child
  // component would eventually return `null`.
  const tabBar =
    tabs.length === 0 ? null : (
      <TabBar tabs={tabs} activeKey={activeKey} renderLink={renderLink} onClose={closeTab} />
    );

  const activeWorkspaceName = useMemo(
    () => workspaces.find((w) => w.id === resolvedOrgId)?.name,
    [workspaces, resolvedOrgId],
  );

  // Statically known: the product name is the correct label until a workspace name displaces it.
  const mobileBrand = (
    <span className="text-body-medium truncate font-semibold">
      {activeWorkspaceName ?? 'Docket'}
    </span>
  );

  // The search control needs no data at all — `openPalette` is a local handler — so it is rendered
  // outright rather than stood in for by a grey square of the same size.
  //
  // The timer is NOT duplicated here. Below `lg` the rail's panels are reached from this bar's own
  // panel trigger, so the Focus panel is one tap away by the same route as every other panel — a
  // second timer control beside it would be a second thing to keep in sync with the first.
  const mobileActions = (
    <>
      <button
        type="button"
        aria-label="Search"
        onClick={openPalette}
        className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Search aria-hidden="true" className="size-5" />
      </button>
    </>
  );

  return (
    <VocabularyProvider skin={skin}>
      <BillingRecovery />
      <PageScrollProvider>
        <AthenaShell
          sidebar={sidebar}
          tabBar={tabBar}
          mobileBrand={mobileBrand}
          mobileActions={mobileActions}
          identityUnknown={identityUnknown}
          timerStatus={timerStatus}
          settingsSurface={settingsSurface}
          calendarSurface={calendarSurface}
          locationKey={locationKey}
          sessionOwnerUserId={userId}
          context={
            resolvedOrgId
              ? { workspaceId: resolvedOrgId, workspaceName: activeWorkspaceName }
              : null
          }
          standingNotice={standingNotice}
          hasQueuedWork={hasQueuedWork}
          unavailable={unavailable}
          offline={offline}
          sessionRejected={sessionRejected}
        >
          {children}
        </AthenaShell>
      </PageScrollProvider>
    </VocabularyProvider>
  );
}

interface AthenaShellProps {
  readonly sidebar: ReactNode;
  readonly tabBar: ReactNode;
  readonly mobileBrand: ReactNode;
  readonly mobileActions: ReactNode;
  readonly identityUnknown: boolean;
  readonly timerStatus: TimerStatus;
  readonly settingsSurface: boolean;
  readonly calendarSurface: boolean;
  readonly locationKey: string;
  /** Account id captured by the shell for destructive session commands. */
  readonly sessionOwnerUserId: string | null;
  readonly context: PersonalAthenaContext | null;
  readonly standingNotice: ReactNode;
  readonly hasQueuedWork: boolean;
  readonly unavailable: boolean;
  readonly offline: { readonly online: boolean; readonly onRetry: () => void } | null;
  readonly sessionRejected: boolean;
  readonly children: ReactNode;
}

/** Keep Athena's contextual state separate from the shell-owned rail selection and visibility. */
function AthenaShell({
  settingsSurface,
  calendarSurface,
  context,
  locationKey,
  sessionOwnerUserId,
  ...props
}: AthenaShellProps): JSX.Element {
  const router = useRouter();
  const [railRequest, setRailRequest] = useState<{
    readonly panelId: string;
    readonly version: number;
  }>();
  const [athenaRailVisible, setAthenaRailVisible] = useState(false);
  const revealRailPanel = useCallback((panelId: 'agenda' | 'focus' | 'athena') => {
    setRailRequest((current) => ({ panelId, version: (current?.version ?? 0) + 1 }));
  }, []);
  const openFullAthena = useCallback(
    (nextContext: PersonalAthenaContext | null, draft: string | undefined) => {
      router.push(athenaHref(nextContext, null, draft !== undefined));
    },
    [router],
  );

  return (
    <AthenaPanelProvider
      context={context}
      locationKey={locationKey}
      railVisible={athenaRailVisible}
      onRevealRail={
        calendarSurface || settingsSurface
          ? undefined
          : () => {
              revealRailPanel('athena');
            }
      }
      onOpenFullAthena={openFullAthena}
    >
      <AthenaShellChrome
        {...props}
        settingsSurface={settingsSurface}
        calendarSurface={calendarSurface}
        railRequest={railRequest}
        onAthenaRailVisibilityChange={setAthenaRailVisible}
      />
      <CommandPaletteHost
        panelsAvailable={!settingsSurface && !calendarSurface}
        onOpenPanel={revealRailPanel}
        sessionOwnerUserId={sessionOwnerUserId}
      />
    </AthenaPanelProvider>
  );
}

interface AthenaShellChromeProps extends Omit<
  AthenaShellProps,
  'context' | 'locationKey' | 'sessionOwnerUserId'
> {
  readonly railRequest: { readonly panelId: string; readonly version: number } | undefined;
  readonly onAthenaRailVisibilityChange: (visible: boolean) => void;
}

/** Render the app shell after Athena can supply its panel content and accessibility status. */
function AthenaShellChrome({
  sidebar,
  tabBar,
  mobileBrand,
  mobileActions,
  identityUnknown,
  timerStatus,
  settingsSurface,
  calendarSurface,
  standingNotice,
  hasQueuedWork,
  unavailable,
  offline,
  sessionRejected,
  railRequest,
  onAthenaRailVisibilityChange,
  children,
}: AthenaShellChromeProps): JSX.Element {
  const athena = useAthenaPanel();
  const athenaRail: RailPanel = {
    id: 'athena',
    label: 'Athena',
    icon: <Sparkles aria-hidden="true" />,
    node: identityUnknown ? <AppShellAgendaSkeleton /> : <AthenaRailPanel />,
    ...(identityUnknown || !athena.railStatus ? {} : { status: athena.railStatus }),
  };

  return (
    <AppShell
      sidebar={sidebar}
      tabBar={tabBar}
      mobileBrand={mobileBrand}
      mobileActions={mobileActions}
      contentOverlay={<NavigationProgress />}
      banner={
        standingNotice || hasQueuedWork ? (
          <Stack gap={2}>
            {standingNotice}
            <OfflineSyncIndicator />
          </Stack>
        ) : undefined
      }
      aside={
        settingsSurface || calendarSurface
          ? undefined
          : railAsideFor(identityUnknown, timerStatus, athenaRail)
      }
      railRequest={railRequest}
      onRailStateChange={({ activePanelId, visible }) => {
        onAthenaRailVisibilityChange(activePanelId === 'athena' && visible);
      }}
    >
      {unavailable ? (
        <OfflineContent online={offline?.online ?? false} onRetry={offline?.onRetry} />
      ) : sessionRejected ? null : (
        <SettingsShell active={settingsSurface}>{children}</SettingsShell>
      )}
      <CreationDestinationProvider>
        <GlobalTaskComposer />
        <GlobalProjectComposer />
        <GlobalInitiativeComposer />
        <GlobalProgramComposer />
        <GlobalTeamComposer />
      </CreationDestinationProvider>
    </AppShell>
  );
}
