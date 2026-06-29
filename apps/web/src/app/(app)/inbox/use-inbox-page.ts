'use client';

import type { AuditEventOut, NotificationOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { isApproval } from '@/components/inbox/notification-meta';
import type { SegmentDef } from '@/components/inbox/segmented-tabs';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { queryKeys, useApiQuery } from '@/lib/query';

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
  error: string | null;
  actionError: string | null;
  pendingIds: ReadonlySet<string>;
  markingAll: boolean;
  segments: readonly SegmentDef<InboxTab>[];
  /** Force a re-fetch (error-state retry). */
  refetch: () => void;
  onApprove: (id: string) => Promise<void>;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}

/**
 * Coordinates the Inbox screen via the shared {@link useApiQuery} layer.
 *
 * @remarks
 * Three live queries (notifications list, pending-approval count, activity feed) auto-refetch on
 * window focus + after the 30s stale window, so the page needs no manual Refresh control. The
 * count key is nested under the notifications key, so a single `invalidate(notifications())` after
 * a mutation re-syncs both the list and the count from the server.
 */
export function useInboxPage(): InboxPageData {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<InboxTab>('inbox');
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const inboxQ = useApiQuery(
    queryKeys.notifications(),
    () => api.v1.notifications.$get({ query: {} }),
    'Could not load your inbox.',
  );
  const countQ = useApiQuery(
    queryKeys.notificationsCount(),
    () => api.v1.notifications.count.$get(),
    'Could not load your inbox.',
  );
  const activityQ = useApiQuery(
    queryKeys.activity(),
    () => api.v1.hub.activity.$get({ query: { limit: String(ACTIVITY_PAGE_SIZE), order: 'desc' } }),
    'Could not load activity.',
  );

  const notifications = useMemo(() => inboxQ.data?.items ?? [], [inboxQ.data]);
  const activity = useMemo(() => activityQ.data?.items ?? [], [activityQ.data]);
  const pendingApprovals = countQ.data?.pendingApprovals ?? 0;

  const setPending = useCallback((id: string, on: boolean): void => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Re-sync the inbox list + count from the server (count key is nested under notifications). */
  const refreshInbox = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
    [queryClient],
  );

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
        await refreshInbox();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong approving this item.'));
      } finally {
        setPending(id, false);
      }
    },
    [refreshInbox, setPending],
  );

  const onMarkRead = useCallback(
    async (id: string): Promise<void> => {
      setActionError(null);
      setPending(id, true);
      try {
        const res = await api.v1.notifications[':id'].read.$post({ param: { id } });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not mark this item read.'));
          return;
        }
        await refreshInbox();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong updating this item.'));
      } finally {
        setPending(id, false);
      }
    },
    [refreshInbox, setPending],
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
      await refreshInbox();
    } catch (caught) {
      setActionError(readError(caught, 'Something went wrong marking everything read.'));
    } finally {
      setMarkingAll(false);
    }
  }, [refreshInbox]);

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
    loading: inboxQ.isPending,
    error: inboxQ.error ? inboxQ.error.message : null,
    actionError,
    pendingIds,
    markingAll,
    segments,
    refetch: () => {
      void inboxQ.refetch();
      void countQ.refetch();
      void activityQ.refetch();
    },
    onApprove,
    onMarkRead,
    onMarkAllRead,
  };
}
