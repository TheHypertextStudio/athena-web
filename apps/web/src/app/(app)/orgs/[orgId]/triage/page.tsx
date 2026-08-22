'use client';

import { ListView } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Inbox } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useCallback, useMemo, useRef } from 'react';

import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';
import { useInPageSearchTarget } from '@/components/in-page-search/in-page-search-provider';
import { useResidentInPageSearch } from '@/components/in-page-search/use-resident-in-page-search';
import SuggestionsLane from '@/components/triage/suggestions-lane';
import { TriageRow } from '@/components/triage/triage-row';
import { taskListKey } from '@/components/views/task-list-key';
import { entityDragSource } from '@/lib/entity-drag';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { useTriage } from '@/lib/use-triage';

/** TriagePage renders the authenticated triage page. */
export default function TriagePage(): JSX.Element {
  const router = useRouter();
  const params = useAppParams<{ orgId: string }>();
  const orgId = params.orgId;

  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const taskNounPlural = useVocabulary('task', { plural: true });
  const categoryOf = useCategoryOf('task');

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
  } = useTriage(orgId, categoryOf);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const source = useMemo(() => ({ completeness: 'complete' as const, items: queue }), [queue]);
  const searchableText = useCallback(
    (task: (typeof queue)[number]): string => {
      const row = toRow(task);
      const provider =
        task.provenance.source === 'linked'
          ? providerName(task.provenance.sourceIntegrationId)
          : 'Docket';
      return [task.title, groupBy(task).label, row.assigneeName, provider]
        .filter((value): value is string => Boolean(value))
        .join(' ');
    },
    [groupBy, providerName, toRow],
  );
  const search = useResidentInPageSearch({ source, searchableText });
  const { restoreFocus } = useInPageSearchTarget({
    id: 'triage',
    rootRef,
    inputRef: searchInputRef,
    enabled: !loading && !loadError,
  });

  return (
    <div
      ref={rootRef}
      className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-title-large">Triage</h1>
        <p className="text-on-surface-variant text-xs">
          Unsorted incoming work — {taskNounPlural.toLowerCase()} that have no home yet. Sort each
          one onward into a {projectNoun.toLowerCase()} or {programNoun.toLowerCase()}, or dismiss
          it.
        </p>
      </header>

      <SuggestionsLane orgId={orgId} canAct />

      <InPageSearchField
        inputRef={searchInputRef}
        value={search.draft}
        onValueChange={search.setDraft}
        onEscapeEmpty={restoreFocus}
        label="Search the triage queue"
        placeholder="Search every triage item"
        resultCount={search.items.length}
        pending={search.draft !== search.settledQuery}
      />

      {!loading && !loadError ? (
        <p className="text-on-surface-variant text-xs tabular-nums">
          {queue.length} {queue.length === 1 ? 'item' : 'items'} to sort
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-error text-body-medium">
          {actionError}
        </p>
      ) : null}

      <section
        aria-label="Triage queue"
        className="border-outline-variant flex-1 overflow-hidden rounded-xl border"
      >
        {/* placeholder: the triage queue's rows — what has arrived unsorted, and each item's
            title, source and age. The queue's own heading and empty-state copy are static. */}
        {loading ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert" className="text-error text-body-medium p-4">
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
          <div className="relative h-full min-h-0">
            <ListView
              stateKey={search.settledQuery.trim().length > 0 ? 'search' : 'browse'}
              items={search.items}
              label="Triage queue, grouped by team"
              getItemKey={taskListKey}
              groupBy={groupBy}
              rowHeight={40}
              className={search.items.length === 0 ? 'invisible' : undefined}
              renderRow={(task, ctx) => (
                <TriageRow
                  task={toRow(task)}
                  drag={entityDragSource({
                    kind: 'task',
                    id: task.id,
                    organizationId: task.organizationId,
                    title: task.title,
                  })}
                  active={ctx.active}
                  onActivate={ctx.onActivate}
                  rowProps={ctx.rowProps}
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
            {search.items.length === 0 ? (
              <p className="text-on-surface-variant text-body-medium absolute inset-0 flex items-center justify-center p-8 text-center">
                No triage items match this search.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
