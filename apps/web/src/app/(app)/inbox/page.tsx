'use client';

import type { AuditEventOut, NotificationOut } from '@docket/types';
import { CheckCircle2, Inbox as InboxIcon, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ActivityRow } from '@/components/inbox/activity-row';
import { isApproval } from '@/components/inbox/notification-meta';
import { NotificationRow } from '@/components/inbox/notification-row';
import { SegmentedTabs, type SegmentDef } from '@/components/inbox/segmented-tabs';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** The number of activity events pulled per page of the passive awareness feed. */
const ACTIVITY_PAGE_SIZE = 50;

/** The Inbox's two feeds: actionable response queue vs. passive awareness stream. */
type InboxTab = 'inbox' | 'activity';

/**
 * The Hub "Inbox" — the cross-org place for everything that needs a response (§8.1, §5).
 *
 * @remarks
 * A Client Component that aggregates across every org the caller is an active human Actor in.
 * It splits attention into two `tablist` segments:
 *
 * - **Inbox** — the actionable response queue. Agent approval requests sort first, with
 *   one-tap {@link NotificationRow | approve} directly from the feed (low-risk, via the
 *   notification `act` transition); then mentions, assignments, status changes, and other
 *   items that need a reply. Sourced from `api.v1.notifications` (list + `/count` + bulk
 *   `read-all` + per-row `act`/`read`). A "Mark all read" header action clears the queue.
 * - **Activity** — the quieter passive-awareness stream of what happened across the caller's
 *   orgs, sourced from `api.v1.hub.activity`. Read-only; each row links to its subject.
 *
 * Every surfaced item carries its originating `organizationId` and is org-chipped (via
 * {@link OrgChip}) so the cross-org feed is never ambiguous and tenant data is never merged.
 * Data is fetched at runtime (no build-time API dependency). Loading shows skeletons, errors
 * surface inline with `role="alert"` + retry, and each empty feed reads calm.
 */
export default function InboxPage(): JSX.Element {
  const { orgName } = useActiveOrg();
  const [tab, setTab] = useState<InboxTab>('inbox');

  const [notifications, setNotifications] = useState<readonly NotificationOut[]>([]);
  const [activity, setActivity] = useState<readonly AuditEventOut[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Ids of rows with an in-flight inline mutation (approve / mark-read). */
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  /** Whether the bulk "Mark all read" action is in flight. */
  const [markingAll, setMarkingAll] = useState(false);
  /** A non-fatal action error (a failed approve / mark-read), surfaced inline. */
  const [actionError, setActionError] = useState<string | null>(null);

  /** Load both feeds + the unread approval count. `initial` drives skeleton vs. refresh. */
  const load = useCallback(async (initial: boolean): Promise<void> => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [inboxRes, countRes, activityRes] = await Promise.all([
        api.v1.notifications.$get({ query: {} }),
        api.v1.notifications.count.$get(),
        api.v1.hub.activity.$get({
          query: { limit: String(ACTIVITY_PAGE_SIZE), order: 'desc' },
        }),
      ]);
      if (!inboxRes.ok) {
        setError(await readProblem(inboxRes, 'Could not load your inbox.'));
        return;
      }
      setNotifications((await inboxRes.json()).items);
      if (countRes.ok) setPendingApprovals((await countRes.json()).pendingApprovals);
      if (activityRes.ok) setActivity((await activityRes.json()).items);
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading your inbox.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  /** Mark a single row's mutation in/out of flight. */
  const setPending = useCallback((id: string, on: boolean): void => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Locally flip a notification to read (optimistic; the server has the same effect). */
  const markReadLocally = useCallback((id: string): void => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)),
    );
  }, []);

  /** Approve the agent work behind a low-risk approval request, one-tap from the Inbox. */
  const onApprove = useCallback(
    async (id: string): Promise<void> => {
      setActionError(null);
      setPending(id, true);
      try {
        const res = await api.v1.notifications[':id'].act.$post({
          param: { id },
          json: { action: 'approve' },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not approve this item.'));
          return;
        }
        markReadLocally(id);
        setPendingApprovals((c) => Math.max(0, c - 1));
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong approving this item.'));
      } finally {
        setPending(id, false);
      }
    },
    [markReadLocally, setPending],
  );

  /** Mark a single notification read, dismissing it from the attention queue. */
  const onMarkRead = useCallback(
    async (id: string): Promise<void> => {
      setActionError(null);
      setPending(id, true);
      const wasApproval = notifications.some((n) => n.id === id && isApproval(n.type) && !n.readAt);
      try {
        const res = await api.v1.notifications[':id'].read.$post({ param: { id } });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not mark this item read.'));
          return;
        }
        markReadLocally(id);
        if (wasApproval) setPendingApprovals((c) => Math.max(0, c - 1));
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong updating this item.'));
      } finally {
        setPending(id, false);
      }
    },
    [markReadLocally, notifications, setPending],
  );

  /** Mark the caller's entire cross-org inbox read in one action. */
  const onMarkAllRead = useCallback(async (): Promise<void> => {
    setActionError(null);
    setMarkingAll(true);
    try {
      const res = await api.v1.notifications['read-all'].$post({ json: {} });
      if (!res.ok) {
        setActionError(await readProblem(res, 'Could not mark everything read.'));
        return;
      }
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      setPendingApprovals(0);
    } catch (caught) {
      setActionError(readError(caught, 'Something went wrong marking everything read.'));
    } finally {
      setMarkingAll(false);
    }
  }, []);

  /** Approval requests first, then everything else; unread before read within each group. */
  const orderedInbox = useMemo<readonly NotificationOut[]>(() => {
    const rank = (n: NotificationOut): number => {
      const unread = n.readAt ? 1 : 0;
      const kind = isApproval(n.type) ? 0 : 2;
      return kind + unread;
    };
    return [...notifications].sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [notifications]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);

  const segments = useMemo<readonly SegmentDef<InboxTab>[]>(
    () => [
      { id: 'inbox', label: 'Inbox', count: unreadCount, emphasis: pendingApprovals > 0 },
      { id: 'activity', label: 'Activity' },
    ],
    [unreadCount, pendingApprovals],
  );

  const panelId = (id: InboxTab): string => `inbox-${id}-panel`;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-muted-foreground text-sm">
            Everything that needs a response, across every organization.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void load(false);
          }}
          disabled={loading || refreshing}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          label="Inbox feeds"
          segments={segments}
          value={tab}
          onChange={setTab}
          panelId={panelId}
        />
        {tab === 'inbox' && !loading && unreadCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={markingAll}
            onClick={() => {
              void onMarkAllRead();
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            {markingAll ? 'Marking…' : 'Mark all read'}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-center justify-between gap-4 rounded-lg border p-4 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load(true);
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {actionError && !error ? (
        <p role="alert" className="text-destructive text-sm">
          {actionError}
        </p>
      ) : null}

      {/* ── Inbox feed (actionable) ───────────────────────────────────────── */}
      <section
        role="tabpanel"
        id={panelId('inbox')}
        aria-labelledby={`${panelId('inbox')}-tab`}
        hidden={tab !== 'inbox'}
        className="flex min-w-0 flex-col gap-2"
      >
        {loading ? (
          <FeedSkeleton />
        ) : orderedInbox.length > 0 ? (
          orderedInbox.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              orgName={notification.organizationId ? orgName(notification.organizationId) : null}
              onApprove={(id) => {
                void onApprove(id);
              }}
              onMarkRead={(id) => {
                void onMarkRead(id);
              }}
              pending={pendingIds.has(notification.id)}
            />
          ))
        ) : (
          <EmptyState
            title="Inbox zero"
            body="No approvals, mentions, or assignments need your response right now."
          />
        )}
      </section>

      {/* ── Activity feed (passive awareness) ─────────────────────────────── */}
      <section
        role="tabpanel"
        id={panelId('activity')}
        aria-labelledby={`${panelId('activity')}-tab`}
        hidden={tab !== 'activity'}
        className="flex min-w-0 flex-col gap-0.5"
      >
        {loading ? (
          <FeedSkeleton />
        ) : activity.length > 0 ? (
          activity.map((event) => (
            <ActivityRow key={event.id} event={event} orgName={orgName(event.organizationId)} />
          ))
        ) : (
          <EmptyState
            title="Nothing yet"
            body="Activity across your organizations will show up here as work happens."
          />
        )}
      </section>
    </div>
  );
}

/** Props for {@link EmptyState}. */
interface EmptyStateProps {
  /** The empty-state headline. */
  readonly title: string;
  /** The empty-state supporting copy. */
  readonly body: string;
}

/** A calm, centered empty state for a feed with no content. */
function EmptyState({ title, body }: EmptyStateProps): JSX.Element {
  return (
    <div className="border-border/60 mt-2 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full"
      >
        <InboxIcon className="h-5 w-5" />
      </span>
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-xs text-sm">{body}</p>
    </div>
  );
}

/** Loading placeholder for either feed: a short stack of row skeletons. */
function FeedSkeleton(): JSX.Element {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="flex items-start gap-3 rounded-lg px-3 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
