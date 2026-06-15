'use client';

import type { AuditEventOut, NotificationOut } from '@docket/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isApproval } from '@/components/inbox/notification-meta';
import type { SegmentDef } from '@/components/inbox/segmented-tabs';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** The Inbox's two feeds. */
type InboxTab = 'inbox' | 'activity';

/** The number of activity events pulled per page of the passive awareness feed. */
const ACTIVITY_PAGE_SIZE = 50;

/** All state + actions the Inbox page needs from the data layer. */
export interface InboxPageData {
  tab: InboxTab;
  setTab: (tab: InboxTab) => void;
  orderedInbox: readonly NotificationOut[];
  activity: readonly AuditEventOut[];
  unreadCount: number;
  pendingApprovals: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  actionError: string | null;
  pendingIds: ReadonlySet<string>;
  markingAll: boolean;
  segments: readonly SegmentDef<InboxTab>[];
  load: (initial: boolean) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}

/** useInboxPage coordinates inbox state, loading, and mutations for its screen. */
export function useInboxPage(): InboxPageData {
  const [tab, setTab] = useState<InboxTab>('inbox');
  const [notifications, setNotifications] = useState<readonly NotificationOut[]>([]);
  const [activity, setActivity] = useState<readonly AuditEventOut[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const setPending = useCallback((id: string, on: boolean): void => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const markReadLocally = useCallback((id: string): void => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)),
    );
  }, []);

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

  return {
    tab,
    setTab,
    orderedInbox,
    activity,
    unreadCount,
    pendingApprovals,
    loading,
    refreshing,
    error,
    actionError,
    pendingIds,
    markingAll,
    segments,
    load,
    onApprove,
    onMarkRead,
    onMarkAllRead,
  };
}
