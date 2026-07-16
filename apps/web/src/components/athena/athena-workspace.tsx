'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import {
  personalAthenaDetailDef,
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import {
  groupAthenaQueue,
  type PersonalAthenaContext,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { queryKeys, useLiveApiQuery } from '@/lib/query';

import { AthenaWorkbench } from './athena-workbench';
import { useAthenaActions } from './use-athena-actions';

/** Props for the full personal Athena operations workspace. */
export interface AthenaWorkspaceProps {
  readonly initialSessionId?: string | null;
  readonly workspaceFilter?: string | null;
  readonly invocationContext?: PersonalAthenaContext | null;
  readonly transport?: PersonalAthenaTransport;
}

/** Derive the selected session entirely from the currently visible workspace roster. */
export function effectiveAthenaSelectedId(
  selectedId: string,
  initialSessionId: string | null,
  visibleSessions: readonly PersonalAthenaSessionSummary[],
): string {
  if (visibleSessions.some((session) => session.id === selectedId)) return selectedId;
  return (
    visibleSessions.find((session) => session.id === initialSessionId)?.id ??
    visibleSessions[0]?.id ??
    ''
  );
}

/** Render the responsive cross-workspace queue, selected workbench, and contextual receipt rail. */
export function AthenaWorkspace({
  initialSessionId = null,
  workspaceFilter = null,
  invocationContext = null,
  transport = personalAthenaTransport,
}: AthenaWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const queue = useLiveApiQuery(personalAthenaQueueDef(transport), 5_000);
  const allSessions = useMemo(
    () =>
      queue.data
        ? [
            ...queue.data.sessions.needsYou,
            ...queue.data.sessions.working,
            ...queue.data.sessions.finished,
          ]
        : [],
    [queue.data],
  );
  const visibleSessions = useMemo(
    () =>
      workspaceFilter
        ? allSessions.filter(
            (session) =>
              session.workspace?.id === workspaceFilter ||
              session.context?.workspaceId === workspaceFilter,
          )
        : allSessions,
    [allSessions, workspaceFilter],
  );
  const groups = useMemo(() => groupAthenaQueue(visibleSessions), [visibleSessions]);
  const [selectedId, setSelectedId] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const effectiveSelectedId = effectiveAthenaSelectedId(
    selectedId,
    initialSessionId,
    visibleSessions,
  );
  useEffect(() => {
    if (!queue.data) return;
    if (selectedId !== effectiveSelectedId) setSelectedId(effectiveSelectedId);
  }, [effectiveSelectedId, queue.data, selectedId]);
  const detail = useLiveApiQuery(personalAthenaDetailDef(effectiveSelectedId, transport), 3_000);

  const updateSelected = useCallback(
    (next: PersonalAthenaSessionDetail): void => {
      queryClient.setQueryData(queryKeys.athenaSession(next.id), next);
      setSelectedId(next.id);
    },
    [queryClient],
  );
  const actions = useAthenaActions({
    selectedId: effectiveSelectedId,
    transport,
    onSelected: updateSelected,
    onCreated: (next) => {
      updateSelected(next);
      setNewObjective('');
    },
  });
  const pending = actions.pending;

  return (
    <div data-athena-workspace className="bg-surface flex h-full min-h-0 w-full flex-col">
      <header className="border-outline-variant flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 @2xl:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-[-0.015em]">
            Your Athena work
          </h1>
          <p className="text-on-surface-variant mt-0.5 text-sm">
            Work moving across every workspace, with decisions kept private to you.
          </p>
        </div>
        {queue.data ? (
          <div className="text-on-surface-variant flex items-center gap-3 text-xs tabular-nums">
            <span>{queue.data.counts.needsYou} needs you</span>
            <span>{queue.data.counts.working} working</span>
          </div>
        ) : null}
      </header>

      {actions.feedback ? (
        <p
          role="alert"
          aria-live="assertive"
          className="border-outline-variant bg-error-container text-on-error-container border-b px-4 py-3 text-sm"
        >
          {actions.feedback}
        </p>
      ) : null}

      {queue.isPending ? (
        <div className="grid min-h-0 flex-1 gap-0 @3xl:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="border-outline-variant flex flex-col gap-3 border-r p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="m-6 h-64" />
        </div>
      ) : queue.isError ? (
        <p role="status" className="text-on-surface-variant p-6 text-sm">
          Athena work is temporarily unavailable. We&apos;ll keep checking.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @3xl:grid @3xl:grid-cols-[19rem_minmax(0,1fr)] @3xl:overflow-hidden @6xl:grid-cols-[19rem_minmax(0,1fr)_16rem]">
          <nav
            aria-label="Athena work queue"
            className="border-outline-variant bg-surface-container-low max-h-[34vh] shrink-0 overflow-y-auto border-b @3xl:max-h-none @3xl:border-r @3xl:border-b-0"
          >
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`athena-lane-${group.key}`}>
                <div className="border-outline-variant bg-surface-container-low sticky top-0 z-10 flex items-center justify-between border-b px-3 py-2">
                  <h2
                    id={`athena-lane-${group.key}`}
                    className="text-on-surface text-xs font-semibold"
                  >
                    {group.label}
                  </h2>
                  <span className="text-on-surface-variant text-xs tabular-nums">
                    {group.items.length}
                  </span>
                </div>
                {group.items.length > 0 ? (
                  <ul className="divide-outline-variant divide-y">
                    {group.items.map((session) => (
                      <QueueRow
                        key={session.id}
                        session={session}
                        selected={session.id === effectiveSelectedId}
                        onSelect={() => {
                          setSelectedId(session.id);
                        }}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </nav>

          <main className="flex min-h-[32rem] min-w-0 shrink-0 flex-col @3xl:min-h-0">
            {effectiveSelectedId && detail.isPending ? (
              <div className="flex flex-col gap-3 p-6">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : detail.data ? (
              <AthenaWorkbench
                session={detail.data}
                pending={pending}
                onMessage={(body) => {
                  actions.message(body);
                }}
                onLifecycle={(action) => {
                  actions.lifecycle(action);
                }}
                onDecision={(id, option) => {
                  actions.decide({ id, option, kind: detail.data.decision?.kind });
                }}
              />
            ) : (
              <form
                aria-label="Start Athena work"
                className="flex flex-1 items-center p-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  const prompt = newObjective.trim();
                  if (!prompt || actions.createPending) return;
                  actions.create({
                    prompt,
                    ...(invocationContext
                      ? { context: invocationContext }
                      : workspaceFilter
                        ? { context: { workspaceId: workspaceFilter } }
                        : {}),
                  });
                }}
              >
                <div className="w-full max-w-xl">
                  <h2 className="text-on-surface text-xl font-semibold">
                    What should Athena move forward?
                  </h2>
                  <p className="text-on-surface-variant mt-1 text-sm leading-6">
                    Give Athena an objective. It will keep the work here while it moves in the
                    background.
                  </p>
                  <label className="mt-5 block">
                    <span className="text-on-surface text-sm font-medium">Objective</span>
                    <textarea
                      aria-label="Athena objective"
                      rows={4}
                      value={newObjective}
                      disabled={actions.createPending}
                      placeholder="Prepare tomorrow morning…"
                      onChange={(event) => {
                        setNewObjective(event.target.value);
                      }}
                      className="border-outline-variant bg-surface-container-low text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring mt-2 w-full resize-none rounded-lg border p-3 text-sm leading-6 outline-none focus-visible:ring-2"
                    />
                  </label>
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="submit"
                      disabled={actions.createPending || newObjective.trim().length === 0}
                      className="min-h-10"
                    >
                      {actions.createPending ? 'Starting…' : 'Start work'}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </main>

          <aside className="border-outline-variant bg-surface-container-low hidden overflow-y-auto border-l p-4 @6xl:block">
            <h2 className="text-on-surface text-sm font-semibold">Current context</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-on-surface-variant text-xs">Workspace</dt>
                <dd className="text-on-surface mt-0.5 break-words">
                  {detail.data?.workspace?.name ??
                    detail.data?.context?.workspaceName ??
                    detail.data?.context?.source?.label ??
                    invocationContext?.workspaceName ??
                    'Across workspaces'}
                </dd>
              </div>
              {(detail.data?.context?.source ?? invocationContext?.source) ? (
                <div>
                  <dt className="text-on-surface-variant text-xs">Opened from</dt>
                  <dd className="text-on-surface mt-0.5 break-words">
                    {(detail.data?.context?.source ?? invocationContext?.source)?.label ?? 'Work'}
                  </dd>
                </div>
              ) : null}
            </dl>
            {detail.data?.result ? (
              <div className="border-outline-variant mt-6 border-t pt-4">
                <h2 className="text-on-surface text-sm font-semibold">Result receipt</h2>
                <p className="text-on-surface-variant mt-2 text-sm leading-6">
                  {detail.data.result.summary}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

/** Dense queue row with enough context to distinguish similarly named work. */
function QueueRow({
  session,
  selected,
  onSelect,
}: {
  readonly session: PersonalAthenaSessionSummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className="focus-visible:ring-ring hover:bg-surface-container-high aria-[current=true]:bg-primary-container/45 flex min-h-16 w-full flex-col items-start justify-center gap-1 px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-on-surface line-clamp-2 text-sm leading-5 font-medium">
          {session.objective}
        </span>
        <span className="text-on-surface-variant flex w-full min-w-0 items-center gap-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate">
            {session.workspace?.name ??
              session.context?.workspaceName ??
              session.context?.source?.label ??
              'Across workspaces'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">
            {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
              new Date(session.updatedAt),
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
