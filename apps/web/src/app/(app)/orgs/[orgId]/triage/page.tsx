'use client';

import { ListView } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Inbox } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX } from 'react';

import SuggestionsLane from '@/components/triage/suggestions-lane';
import { TriageRow } from '@/components/triage/triage-row';
import { useTriage } from '@/lib/use-triage';

/** TriagePage renders the authenticated triage page. */
export default function TriagePage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const taskNounPlural = useVocabulary('task', { plural: true });

  const {
    queue,
    loading,
    loadError,
    actionError,
    pending,
    projectDestinations,
    programDestinations,
    providerName,
    canEdit,
    rename,
    toRow,
    groupBy,
    sortToProject,
    sortToProgram,
    dismiss,
  } = useTriage(orgId);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-title-large">Triage</h1>
        <p className="text-on-surface-variant text-xs">
          Unsorted incoming work — {taskNounPlural.toLowerCase()} that have no home yet. Sort each
          one onward into a {projectNoun.toLowerCase()} or {programNoun.toLowerCase()}, or dismiss
          it.
        </p>
      </header>

      <SuggestionsLane orgId={orgId} canAct />

      {!loading && !loadError ? (
        <p className="text-on-surface-variant text-xs tabular-nums">
          {queue.length} {queue.length === 1 ? 'item' : 'items'} to sort
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-destructive text-body-medium">
          {actionError}
        </p>
      ) : null}

      <section
        aria-label="Triage queue"
        className="border-outline-variant flex-1 overflow-hidden rounded-xl border"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive text-body-medium p-4">
            {loadError}
          </p>
        ) : queue.length === 0 ? (
          <div className="text-on-surface-variant flex flex-col items-center gap-3 p-12 text-center">
            <Inbox className="h-8 w-8 opacity-50" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="text-on-surface text-body-medium font-medium">Triage is clear</p>
              <p className="text-body-medium">
                Nothing unsorted right now. New incoming work shows up here for you to sort.
              </p>
            </div>
          </div>
        ) : (
          <ListView
            items={queue}
            label="Triage queue, grouped by team"
            getItemKey={(task) => task.id}
            groupBy={groupBy}
            rowHeight={40}
            renderRow={(task, ctx) => (
              <TriageRow
                task={toRow(task)}
                active={ctx.active}
                onActivate={ctx.onActivate}
                canEdit={canEdit}
                onRename={rename}
                busy={pending.has(task.id)}
                projects={projectDestinations}
                programs={programDestinations}
                projectNoun={projectNoun}
                programNoun={programNoun}
                providerName={providerName}
                onAssignProject={(projectId) => {
                  void sortToProject(task.id, projectId);
                }}
                onAssignProgram={(programId) => {
                  void sortToProgram(task.id, programId);
                }}
                onDismiss={() => {
                  void dismiss(task.id);
                }}
              />
            )}
            onActivateItem={(task) => {
              router.push(`/orgs/${orgId}/tasks/${task.id}`);
            }}
          />
        )}
      </section>
    </div>
  );
}
