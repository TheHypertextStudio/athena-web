'use client';

import type { CycleTaskGroupBy, TaskOut } from '@docket/types';
import { CycleId, TeamId } from '@docket/types';
import { EmptyState, type EntityTableGroup } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton, Tabs, type TabsItem } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useMemo, useState } from 'react';

import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import type { ActorDirectory } from '@/components/agents/actor-directory';
import { CloseCycleDialog } from '@/components/cycles/close-cycle-dialog';
import { CycleMetadata } from '@/components/cycle-detail/cycle-metadata-row';
import { CyclePacePanel } from '@/components/cycle-detail/cycle-pace-panel';
import { formatWindow, windowProgress, windowRunway } from '@/components/cycles/format-window';
import { GroupByMenu } from '@/components/cycles/group-by-menu';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { QuickAddTaskRow } from '@/components/tasks/quick-add-task-row';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { PageContainer } from '@/components/views/page-layout';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { api } from '@/lib/api';
import { asNameMap, cycleDetailDef } from '@/lib/fetch-cycle-detail';
import { queryKeys, unwrap, useApiMutation, useApiQuery, usePrefetchApi } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';
import { EditableTitle } from '@/components/editor/editable-title';
import { useCycleMutations } from '@/lib/use-cycle-mutations';
import { useRenameTask } from '@/lib/use-rename-task';
import { useOrgCapability } from '@/lib/use-org-capability';
import { STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';
import { userErrorMessage } from '@/lib/problem';

/** The detail page's two sections. */
type TabId = 'tasks' | 'pace';

/**
 * The masthead's one-line summary: the runway, prefixed by the window only when it adds a fact.
 *
 * @remarks
 * An unnamed cycle is titled by its window (`displayName`), so prefixing the window here would
 * print the same six words twice, one line apart. A named cycle's title says nothing about when it
 * runs, so there the window is the first thing the line must supply. Exported for the unit test
 * that pins both branches.
 *
 * @param name - The cycle's author-set name, or `null`/`undefined` when it has none.
 * @param startsAt - The window start (ISO-8601).
 * @param endsAt - The window end (ISO-8601).
 * @returns the subtitle line, e.g. `"Day 7 of 7 · last day"` or
 *   `"Jul 27 – Aug 2 · Day 7 of 7 · last day"`.
 */
export function cycleSubtitle(
  name: string | null | undefined,
  startsAt: string,
  endsAt: string,
): string {
  const runway = windowRunway(windowProgress(startsAt, endsAt));
  return name ? `${formatWindow(startsAt, endsAt)} · ${runway}` : runway;
}

/**
 * Cycle detail, composed from the shared entity-detail shell.
 *
 * @remarks
 * Built on {@link EntityDetailLayout} — the same shell Project, Initiative and Program detail
 * compose — rather than the bespoke `<div>` column this screen used to declare for itself. That is
 * what resolves the layout defects structurally instead of by tuning numbers: the shell's
 * {@link PageContainer} owns the measure, the gutters and the single vertical rhythm, so no section
 * carries a width or a margin of its own (the properties card no longer strands 315px of empty
 * space beside it, and the five different inter-section gaps collapse to one). The old page also
 * set `h-full` on that column, which let the browser shrink the pace banner to fit — the direct
 * cause of the empty plot region on desktop and the hairline "rule separating nothing" on mobile.
 *
 * The cycle's epoch-anchored `number` is never rendered — "Cycle 1000135" is not a name a person
 * recognizes, so an unnamed cycle is titled by its window through `displayName`. Two consequences
 * of that fall out here, and both were visible defects before:
 *
 * - **The window is stated once as prose.** An unnamed cycle's title *is* its window, so prefixing
 *   the subtitle with `formatWindow` printed "Jul 27 – Aug 2" twice, one line apart — which reads
 *   as a rendering bug rather than as two facts, and at 390px pushed the runway ("Day 7 of 7 · last
 *   day") past the subtitle's single-line truncation into "…· la…". The subtitle therefore carries
 *   the window only when the title is an author-set name. See {@link cycleSubtitle}. The Window
 *   *chip* below is not a third statement: it is the editable control that sets the window, and a
 *   date control that does not show its date has nothing to press.
 * - **The title reads at full strength either way.** The editable title is fed `displayName`, not
 *   `name ?? ''`. Feeding it the raw `name` left an unnamed cycle's `<input>` empty, so the window
 *   arrived as the field's `placeholder` — rendered at the browser's grey placeholder colour, so a
 *   cycle's own name looked like un-entered text, and looked *different* to a viewer who may not
 *   edit (who gets a plain span at full strength). It also left the `<h1>` with no text at all,
 *   which is what a screen reader announces the heading as. `displayName` is the name — the same
 *   string the roster, the tab and the close dialog render — so it is what the field holds. Saving
 *   is unaffected: `EditableTitle` only calls `onSave` for a value that differs from the one it was
 *   given, so opening the field and leaving it alone writes nothing, and `onSave` still persists to
 *   `name` (the derived default keeps following the window until someone types a real name).
 */
export default function CycleDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useAppParams<{ orgId: string; cycleId: string }>();
  const { orgId, cycleId } = params;
  const prefetch = usePrefetchApi();

  const cycleNoun = useVocabulary('cycle');
  const cycleNounLower = cycleNoun.toLowerCase();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const detailKey = queryKeys.cycle(orgId, cycleId);

  const detailQ = useApiQuery(
    cycleDetailDef(orgId, cycleId, `Could not load this ${cycleNounLower}.`),
  );
  const data = detailQ.data ?? null;
  const cycle = data?.cycle ?? null;

  // The tab bar and the browser tab both follow the name on screen, including through a rename.
  useRegisterTabTitle('cycle', orgId, cycleId, cycle?.displayName);
  useDocumentTitle(cycle?.displayName);
  const burnup = data?.burnup ?? null;
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  // Normalized rather than read straight off the query data: a cache restored from IndexedDB has
  // been through JSON, which turns these lookups into plain objects (see {@link asNameMap}).
  const projectName = useMemo(() => asNameMap(data?.projectName), [data]);
  const programName = useMemo(() => asNameMap(data?.programName), [data]);
  const otherCycles = useMemo(() => data?.otherCycles ?? [], [data]);
  const members = data?.members ?? [];
  const roles = data?.roles ?? [];
  const resolveActor = useMemo<ActorDirectory['resolve']>(
    () => data?.resolveActor ?? (() => ({ name: 'Someone', kind: 'human' as const })),
    [data],
  );

  const [groupBy, setGroupBy] = useState<CycleTaskGroupBy>('project');
  const [tab, setTab] = useState<TabId>('tasks');

  const {
    patchCycle,
    propsError,
    dialogOpen,
    setDialogOpen,
    decisions,
    closeError,
    moveTargets,
    closing,
    openCloseDialog,
    onActionChange,
    onTargetChange,
    confirmClose,
  } = useCycleMutations(orgId, cycleId, cycleNounLower, tasks, otherCycles, detailKey);

  const canEditCycle = useOrgCapability(members, roles, 'contribute');
  const renameCycleTask = useRenameTask(orgId, [detailKey]);

  // Inline quick-add: commit a new task to this cycle from just a typed title, on the cycle's own
  // team. Refreshes the cycle detail so the new task drops straight into the committed list.
  const createCycleTask = useApiMutation<TaskOut, string>({
    mutationFn: (title) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks.$post({
            param: { orgId },
            json: {
              title,
              teamId: TeamId.parse(cycle?.teamId ?? ''),
              priority: 'none',
              cycleId: CycleId.parse(cycleId),
            },
          }),
        `Could not add the ${cycleNounLower} task.`,
      ),
    invalidateKeys: [detailKey],
  });

  const columns = useMemo(() => {
    const catalog = buildTaskCatalog({
      projectLabel: projectNoun,
      programLabel: programNoun,
      resolveProject: (id) => projectName.get(id) ?? id,
      resolveProgram: (id) => programName.get(id) ?? id,
      resolveAssignee: (id) => resolveActor(id).name,
      assigneeOptions: () => [],
      projectOptions: () => [],
      programOptions: () => [],
    });
    return buildTaskColumns({
      catalog,
      resolveActor: (id) => resolveActor(id),
      canEdit: canEditCycle,
      onRename: renameCycleTask,
      onOpen: (task) => {
        router.push(`/orgs/${orgId}/tasks/${task.id}`);
      },
    });
  }, [
    projectNoun,
    programNoun,
    projectName,
    programName,
    resolveActor,
    canEditCycle,
    renameCycleTask,
    router,
    orgId,
  ]);

  const orderedTasks = useMemo(() => {
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...tasks].sort((a, b) => rank(a) - rank(b));
  }, [tasks]);

  const taskGroups = useMemo<EntityTableGroup<TaskOut>[]>(() => {
    const axisValue = (task: TaskOut): string | null =>
      groupBy === 'project' ? (task.projectId ?? null) : (task.programId ?? null);
    const axisLabel = (id: string): string =>
      groupBy === 'project'
        ? (projectName.get(id) ?? projectNoun)
        : (programName.get(id) ?? programNoun);
    const NONE_ID = '__none__';
    const noneLabel = groupBy === 'project' ? `No ${projectNoun}` : `No ${programNoun}`;
    const byId = new Map<string, TaskOut[]>();
    const order: string[] = [];
    for (const task of orderedTasks) {
      const id = axisValue(task) ?? NONE_ID;
      let bucket = byId.get(id);
      if (!bucket) {
        bucket = [];
        byId.set(id, bucket);
        order.push(id);
      }
      bucket.push(task);
    }
    order.sort((a, b) => (a === NONE_ID ? 1 : 0) - (b === NONE_ID ? 1 : 0));
    return order.map((id) => ({
      id,
      label: id === NONE_ID ? noneLabel : axisLabel(id),
      rows: byId.get(id) ?? [],
    }));
  }, [orderedTasks, groupBy, projectName, programName, projectNoun, programNoun]);

  const tabItems: readonly TabsItem[] = [
    { value: 'tasks', label: 'Tasks' },
    { value: 'pace', label: 'Pace' },
  ];

  if (detailQ.isPending) {
    // placeholder: everything on a cycle detail screen is the cycle's own record — its name, its
    // date range, the progress summary, the grouping axis its board was last left on, and the
    // tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier.
    return (
      <PageContainer>
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-10 w-80 rounded-full" />
        <Skeleton className="h-10 w-56 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageContainer>
    );
  }

  if (detailQ.isError) {
    return (
      <PageContainer>
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(detailQ.error, `Could not load this ${cycleNounLower}.`)}
        </p>
      </PageContainer>
    );
  }

  if (!cycle) {
    return (
      <PageContainer>
        <EmptyState
          icon={RefreshCw}
          title={`This ${cycleNounLower} could not be found`}
          body="It may have been removed, or the link may point somewhere that no longer exists."
        />
      </PageContainer>
    );
  }

  const win = windowProgress(cycle.startsAt, cycle.endsAt);
  const isCompleted = cycle.status === 'completed';
  const canEditNow = canEditCycle && !isCompleted;

  return (
    <EntityDetailLayout
      object={{
        kind: 'cycle',
        id: cycleId,
        organizationId: orgId,
        title: cycle.displayName,
      }}
      icon={
        <span className="flex size-12 shrink-0 items-center justify-center">
          <span className="bg-surface-container-high text-on-surface-variant flex size-12 items-center justify-center rounded-full">
            <RefreshCw aria-hidden className="size-6" />
          </span>
        </span>
      }
      title={
        <EditableTitle
          value={cycle.displayName}
          onSave={(name) => {
            patchCycle({ name });
          }}
          canEdit={canEditCycle}
          ariaLabel={`${cycleNoun} name`}
          placeholder={cycle.displayName}
          className="text-on-surface text-headline-medium font-medium"
        />
      }
      subtitle={cycleSubtitle(cycle.name, cycle.startsAt, cycle.endsAt)}
      metadata={
        <>
          <EntityMetadataRow ariaLabel={`${cycleNoun} properties`}>
            <CycleMetadata
              status={cycle.status}
              startsAt={cycle.startsAt.slice(0, 10)}
              endsAt={cycle.endsAt.slice(0, 10)}
              canEdit={canEditNow}
              onStatusChange={(status) => {
                patchCycle({ status });
              }}
              onWindowChange={({ start, end }) => {
                patchCycle({
                  ...(start ? { startsAt: start } : {}),
                  ...(end ? { endsAt: end } : {}),
                });
              }}
            />
          </EntityMetadataRow>
          {propsError ? (
            <p role="alert" className="text-error text-body-medium">
              {propsError}
            </p>
          ) : null}
        </>
      }
      actions={
        isCompleted ? null : (
          <Button variant="outline" size="sm" onClick={openCloseDialog}>
            Close {cycleNounLower}
          </Button>
        )
      }
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label={`${cycleNoun} sections`}
          items={tabItems}
        />
      }
    >
      {tab === 'tasks' ? (
        // The trailing space is deliberate and belongs to the panel rather than to the floating
        // Athena button: the button is fixed to the viewport, so content scrolled to its end needs
        // clearance of its own or the last row sits underneath it.
        <div
          role="tabpanel"
          id="tabpanel-tasks"
          aria-labelledby="tab-tasks"
          className="flex flex-col gap-4 pb-32"
        >
          <div className="flex items-center justify-between gap-3">
            <GroupByMenu
              value={groupBy}
              onChange={setGroupBy}
              projectNoun={projectNoun}
              programNoun={programNoun}
            />
            <p className="text-on-surface-variant text-label-large flex h-8 items-center tabular-nums">
              {orderedTasks.length} {orderedTasks.length === 1 ? taskNoun : taskNounPlural}
            </p>
          </div>

          {orderedTasks.length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title="Nothing is committed yet"
              body={`Add the work this ${cycleNounLower} is meant to deliver and it will show up here, grouped by ${projectNoun.toLowerCase()}.`}
            />
          ) : (
            <TaskTable
              label={`${cycle.displayName} ${taskNounPlural}`}
              columns={columns}
              groups={taskGroups}
              taskHref={(task) => `/orgs/${orgId}/tasks/${task.id}`}
              onRowPrefetch={(task) => {
                prefetch(taskDetailDef(orgId, task.id));
              }}
              onOpenTask={(task) => {
                router.push(`/orgs/${orgId}/tasks/${task.id}`);
              }}
            />
          )}

          <QuickAddTaskRow
            canEdit={canEditNow}
            placeholder={`Add a ${taskNoun} to this ${cycleNounLower}…`}
            onAdd={(title) => createCycleTask.mutateAsync(title).then(() => undefined)}
          />
        </div>
      ) : null}

      {tab === 'pace' ? (
        <div
          role="tabpanel"
          id="tabpanel-pace"
          aria-labelledby="tab-pace"
          className="flex flex-col gap-4 pb-32"
        >
          {burnup ? (
            <CyclePacePanel burnup={burnup} window={win} cycleNoun={cycleNounLower} />
          ) : (
            <EmptyState
              icon={Activity}
              title="Pace is unavailable"
              body={`The burn-up for this ${cycleNounLower} could not be read. Reload the page to try again.`}
            />
          )}
        </div>
      ) : null}

      <CloseCycleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cycleName={cycle.displayName}
        cycleNoun={cycleNounLower}
        items={decisions}
        targets={moveTargets}
        closing={closing}
        closeError={closeError}
        onActionChange={onActionChange}
        onTargetChange={onTargetChange}
        onConfirm={() => {
          confirmClose();
        }}
      />
    </EntityDetailLayout>
  );
}
