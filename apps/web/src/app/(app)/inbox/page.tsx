'use client';

import { CheckCircle2, Inbox as InboxIcon, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ActivityRow } from '@/components/inbox/activity-row';
import { NotificationRow } from '@/components/inbox/notification-row';
import { SegmentedTabs } from '@/components/inbox/segmented-tabs';
import { useInboxPage } from './use-inbox-page';

/** InboxPage renders the authenticated inbox page. */
export default function InboxPage(): JSX.Element {
  const { orgName } = useActiveOrg();
  const {
    tab,
    setTab,
    orderedInbox,
    activity,
    unreadCount,
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
  } = useInboxPage();

  const panelId = (id: 'inbox' | 'activity'): string => `inbox-${id}-panel`;

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-h1">Inbox</h1>
          <p className="text-on-surface-variant text-xs">Everything that needs a response.</p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
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
          className="border-destructive/40 bg-destructive/5 text-destructive text-body flex items-center justify-between gap-4 rounded-lg border p-4"
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
        <p role="alert" className="text-destructive text-body">
          {actionError}
        </p>
      ) : null}

      {/* ── Inbox feed (actionable) ───────────────────────────────────────── */}
      <section
        role="tabpanel"
        id={panelId('inbox')}
        aria-labelledby={`${panelId('inbox')}-tab`}
        hidden={tab !== 'inbox'}
        className="flex min-w-0 flex-col gap-1.5"
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
        className="flex min-w-0 flex-col gap-1.5"
      >
        {loading ? (
          <FeedSkeleton />
        ) : activity.length > 0 ? (
          activity.map((event) => (
            <ActivityRow key={event.id} event={event} orgName={orgName(event.organizationId)} />
          ))
        ) : (
          <EmptyState title="Nothing yet" body="Activity will show up here as work happens." />
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
    <div className="border-outline-variant mt-2 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <span
        aria-hidden="true"
        className="bg-surface-container text-on-surface-variant flex h-10 w-10 items-center justify-center rounded-full"
      >
        <InboxIcon className="h-5 w-5" />
      </span>
      <p className="text-on-surface text-body font-medium">{title}</p>
      <p className="text-on-surface-variant max-w-xs text-xs">{body}</p>
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
