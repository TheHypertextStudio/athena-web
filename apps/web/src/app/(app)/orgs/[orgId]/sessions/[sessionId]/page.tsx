'use client';

import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, Sparkles } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type JSX } from 'react';

import { OrgChip } from '@/components/org-chip';
import { ActivityItem } from '@/components/agents/activity-item';
import { SessionStatusPill } from '@/components/agents/session-status';
import { SessionSidebar } from '@/components/agents/session-sidebar';
import { useSessionDetail } from '@/lib/use-session-detail';

/** SessionViewPage renders the authenticated agent session page. */
export default function SessionViewPage(): JSX.Element {
  const params = useParams<{ orgId: string; sessionId: string }>();
  const { orgId, sessionId } = params;
  const taskLabel = useVocabulary('task');

  const {
    session,
    orgName,
    taskTitle,
    loading,
    loadError,
    actionError,
    pendingActivityId,
    controlPending,
    agentActor,
    ownerName,
    initiatorName,
    changes,
    controls,
    approve,
    reject,
    reply,
    transition,
  } = useSessionDetail(orgId, sessionId);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-lg border p-4"
        >
          {loadError}
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant text-body rounded-lg border border-dashed p-6 text-center">
          This session could not be found.
        </p>
      </div>
    );
  }

  const canAct = controls.canCancel || session.status === 'awaiting_approval';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          {session.taskId ? (
            <Link
              href={`/orgs/${orgId}/tasks/${session.taskId}`}
              className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring text-body -ml-1 inline-flex items-center gap-1 rounded px-1 transition-colors outline-none focus-visible:ring-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to {taskTitle ?? taskLabel.toLowerCase()}
            </Link>
          ) : (
            <span className="text-on-surface-variant text-body">Ad-hoc session</span>
          )}
          {orgName ? <OrgChip orgId={orgId} name={orgName} /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-on-surface text-h1 leading-tight">
            {taskTitle ?? `${agentActor.name}'s session`}
          </h1>
          <SessionStatusPill status={session.status} />
        </div>

        {actionError ? (
          <p role="alert" className="text-destructive text-body">
            {actionError}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="activity-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="activity-heading" className="text-on-surface-variant text-xs font-medium">
            Activity
          </h2>
          {session.activities.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No activity yet"
              body="When the agent starts working, its steps will appear here."
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {session.activities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  canAct={canAct}
                  pending={pendingActivityId === activity.id}
                  onApprove={(id) => {
                    void approve(id);
                  }}
                  onReject={(id) => {
                    void reject(id);
                  }}
                  onReply={(id, body) => {
                    void reply(id, body);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <SessionSidebar
          status={session.status}
          agentName={agentActor.name}
          agentAvatarUrl={agentActor.avatarUrl}
          ownerName={ownerName}
          initiatorName={initiatorName}
          changes={changes}
          controls={controls}
          controlPending={controlPending}
          onPause={() => {
            void transition('pause');
          }}
          onTakeOver={() => {
            void transition('resume');
          }}
          onCancel={() => {
            void transition('cancel');
          }}
        />
      </div>
    </div>
  );
}
