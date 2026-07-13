'use client';

import {
  AppShell,
  ContextProvider,
  type HomeNavKey,
  Sidebar,
  TabBar,
  useContextState,
  type Workspace,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { Calendar, Search } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import AccountMenu from '@/components/account-menu';
import { ActiveOrgContext, useActiveOrg } from '@/components/active-org';
import Agenda from '@/components/agenda/agenda';
import { AthenaPanelProvider } from '@/components/athena/athena-panel-provider';
import { useAuthenticationInterlock } from '@/components/authentication-interlock';
import { CommandPaletteProvider, useCommandPalette } from '@/components/command-palette';
import { RecoveryNudgeBanner } from '@/components/recovery-nudge-banner';
import { OpenDocumentsProvider, useOpenDocuments } from '@/components/tabs';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import { STALE, apiQueryOptions, queryKeys, useApiQuery, useLiveApiQuery } from '@/lib/query';
import { CREATE_WORKSPACE_PATH } from '@/lib/workspace-creation';

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
 */
export function AppShellFrame({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const { requireAuthentication } = useAuthenticationInterlock();

  useEffect(() => {
    if (!isPending && !session) {
      const search = searchParams.toString();
      requireAuthentication(`${pathname}${search ? `?${search}` : ''}`);
    }
  }, [isPending, pathname, requireAuthentication, searchParams, session]);

  if (!session) {
    return <AppShellLoadingFrame homeKey={homeKeyFromPath(pathname)} />;
  }

  return (
    <AuthenticatedAppShellFrame
      pathname={pathname}
      routeOrgId={orgIdFromPath(pathname)}
      userId={session.user.id}
    >
      {children}
    </AuthenticatedAppShellFrame>
  );
}

interface AuthenticatedAppShellFrameProps {
  /** Current route pathname used to select shell navigation. */
  readonly pathname: string;
  /** Organization bound by the current route, if any. */
  readonly routeOrgId: string | null;
  /** Authenticated user whose shell preferences should be restored. */
  readonly userId: string;
  /** Authenticated route content. */
  readonly children: ReactNode;
}

/** Mount authenticated queries and providers only after the session has resolved. */
function AuthenticatedAppShellFrame({
  pathname,
  routeOrgId,
  userId,
  children,
}: AuthenticatedAppShellFrameProps): JSX.Element {
  // The caller's orgs drive the sidebar's workspace switcher — read once through the shared query
  // layer, gated on an authenticated session and static-tiered (membership rarely changes within a
  // session), shared with the rest of the app under queryKeys.orgs().
  const orgsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.orgs(),
      () => api.v1.orgs.$get(),
      'Could not load your organizations.',
      { staleTime: STALE.static },
    ),
  );
  const orgs = useMemo(() => orgsQ.data?.items ?? [], [orgsQ.data]);
  const orgsError = orgsQ.error
    ? userErrorMessage(orgsQ.error, 'Could not load your workspaces.')
    : null;

  if (orgsQ.isPending) {
    return <AppShellLoadingFrame homeKey={homeKeyFromPath(pathname)} />;
  }

  const initialOrgId = routeOrgId ?? readLastOrg(userId);

  return (
    <ContextProvider initialContext={initialOrgId} initialDensity={readDensity(userId)}>
      <ActiveOrgContext orgs={orgs} activeOrgId={routeOrgId} orgsError={orgsError}>
        <CommandPaletteProvider>
          <OpenDocumentsProvider userId={userId}>
            <AppShellInner
              routeOrgId={routeOrgId}
              userId={userId}
              workspaceKey={workspaceKeyFromPath(pathname)}
              homeKey={homeKeyFromPath(pathname)}
            >
              {children}
            </AppShellInner>
          </OpenDocumentsProvider>
        </CommandPaletteProvider>
      </ActiveOrgContext>
    </ContextProvider>
  );
}

/** Props for the shell shown before authenticated context is available. */
export interface AppShellLoadingFrameProps {
  /** Home destination to highlight when the pathname is already known. */
  readonly homeKey?: HomeNavKey;
}

/**
 * Render Docket's stable shell while session or workspace context resolves.
 *
 * @remarks
 * Home links remain available because they do not depend on workspace data. Search, workspace
 * switching, account actions, the agenda query, and route children stay unmounted until an
 * authenticated session exists. The same frame is reused by the route-group Suspense fallback,
 * preventing either client session settlement or query-string hydration from blanking the app.
 */
export function AppShellLoadingFrame({ homeKey }: AppShellLoadingFrameProps = {}): JSX.Element {
  const sidebar = (
    <Sidebar
      loading
      workspaces={[]}
      activeHomeKey={homeKey}
      hrefForHome={(key) => `/${key}`}
      hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
      renderLink={renderLink}
      onSelectWorkspace={() => undefined}
      onCreateWorkspace={() => undefined}
      onOpenSearch={() => undefined}
      footer={<AppShellAccountSkeleton />}
    />
  );

  return (
    <ContextProvider initialContext={null} initialDensity="comfortable">
      <VocabularyProvider>
        <AppShell
          sidebar={sidebar}
          mobileBrand={<span className="text-body font-semibold">Docket</span>}
          mobileActions={<Skeleton className="size-9 rounded-lg" aria-hidden="true" />}
          aside={{
            node: <AppShellAgendaSkeleton />,
            label: 'Agenda',
            icon: <Calendar aria-hidden="true" />,
          }}
        >
          <AppShellContentSkeleton />
        </AppShell>
      </VocabularyProvider>
    </ContextProvider>
  );
}

/** Main-panel loading treatment shaped like a page header and a short working set. */
function AppShellContentSkeleton(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading your workspace"
      aria-busy="true"
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8"
    >
      <span className="sr-only">Loading your workspace</span>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-7 w-44 rounded-md" />
        <Skeleton className="h-4 w-72 max-w-full rounded-md" />
      </div>
      <div className="grid gap-4" aria-hidden="true">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-4/5 rounded-xl" />
      </div>
    </div>
  );
}

/** Inert account-area placeholder that preserves the sidebar's vertical balance. */
function AppShellAccountSkeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 py-2" aria-hidden="true">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-24 rounded" />
        <Skeleton className="h-3 w-32 rounded" />
      </div>
    </div>
  );
}

/** Query-free agenda placeholder used to keep the desktop rail geometry stable. */
function AppShellAgendaSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-4" aria-hidden="true">
      <Skeleton className="h-5 w-20 rounded" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

interface AppShellInnerProps {
  routeOrgId: string | null;
  userId: string | null;
  workspaceKey?: WorkspaceNavKey;
  homeKey?: HomeNavKey;
  children: ReactNode;
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
  routeOrgId,
  userId,
  workspaceKey,
  homeKey,
  children,
}: AppShellInnerProps): JSX.Element {
  const router = useRouter();
  const { setContext, density } = useContextState();
  const { orgs, skin } = useActiveOrg();
  const { openPalette } = useCommandPalette();
  const { tabs, activeKey, closeTab } = useOpenDocuments();

  // The sidebar's unread badge polls on a focus-only minute interval, sharing the inbox's
  // notifications-count cache (queryKeys.notificationsCount()) so the two stay in lock-step.
  const unreadCountQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.notificationsCount(),
      () => api.v1.notifications.count.$get(),
      'Could not load notifications.',
      { staleTime: STALE.volatile },
    ),
    60_000,
  );
  const unreadCount = unreadCountQ.data?.unread ?? 0;

  useEffect(() => {
    writeDensity(userId, density);
  }, [userId, density]);

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

  // The personal org owns the account-level Security settings the recovery-codes nudge links to.
  const personalOrgId = useMemo(() => orgs.find((o) => o.isPersonal)?.id ?? null, [orgs]);

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
      workspaces={workspaces}
      activeHomeKey={homeKey}
      activeWorkspaceKey={workspaceKey}
      unreadCount={unreadCount}
      hrefForHome={(key) => `/${key}`}
      hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
      renderLink={renderLink}
      onSelectWorkspace={onSelectWorkspace}
      onCreateWorkspace={onCreateWorkspace}
      onOpenSearch={openPalette}
      personalWorkspace={resolvedOrgIsPersonal}
      footer={<AccountMenu onCreateWorkspace={onCreateWorkspace} />}
    />
  );

  const tabBar = (
    <TabBar tabs={tabs} activeKey={activeKey} renderLink={renderLink} onClose={closeTab} />
  );

  const activeWorkspaceName = useMemo(
    () => workspaces.find((w) => w.id === resolvedOrgId)?.name,
    [workspaces, resolvedOrgId],
  );

  const mobileBrand = (
    <span className="text-body truncate font-semibold">{activeWorkspaceName ?? 'Docket'}</span>
  );

  const mobileActions = (
    <button
      type="button"
      aria-label="Search"
      onClick={openPalette}
      className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Search aria-hidden="true" className="size-5" />
    </button>
  );

  return (
    <VocabularyProvider skin={skin}>
      <AthenaPanelProvider orgId={resolvedOrgId}>
        <AppShell
          sidebar={sidebar}
          tabBar={tabBar}
          banner={<RecoveryNudgeBanner personalOrgId={personalOrgId} userId={userId} />}
          mobileBrand={mobileBrand}
          mobileActions={mobileActions}
          // The portable agenda rides along on every authenticated page as the shell's right rail.
          aside={{ node: <Agenda />, label: 'Agenda', icon: <Calendar aria-hidden="true" /> }}
        >
          {children}
        </AppShell>
      </AthenaPanelProvider>
    </VocabularyProvider>
  );
}
