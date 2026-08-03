'use client';

import type {
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  ProjectOut,
  ProjectOverviewItem,
} from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, GanttChart, ListView, Plus, Workflow } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { STRETCHED_LINK } from '@docket/ui/lib/stretched-link';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { EditableTitle } from '@/components/editor/editable-title';
import { InitiativeIconPicker } from '@/components/initiatives/initiative-icon-picker';
import { CreateProjectDialog } from '@/components/projects/create-project';
import { buildProjectCatalog } from '@/components/projects/project-catalog';
import { buildProjectTimelineCatalog } from '@/components/projects/project-timeline-catalog';
import { ProjectStatusBadge } from '@/components/projects/project-status';
import TimelineCanvas from '@/components/timeline/timeline-canvas';
import TimelineDisplaySections from '@/components/timeline/timeline-display-sections';
import { useTimelineViewport } from '@/components/timeline/use-timeline-viewport';
import type { ScheduleChange } from '@/components/timeline/cascade';
import type { TimelineSpan } from '@/components/timeline/timeline-catalog';
import { type AppliedView, applyView } from '@/components/views/apply-view';
import type { FieldOption } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { entityDragSource } from '@/lib/entity-drag';
import { projectDetailDef } from '@/lib/fetch-project-detail';
import { projectOverviewDef } from '@/lib/fetch-project-overview';
import {
  queryKeys,
  unwrap,
  useApiMutation,
  useApiListQuery,
  useApiQuery,
  usePrefetchApi,
  apiQueryOptions,
} from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { useOrgCapability } from '@/lib/use-org-capability';

/**
 * The dependency canvas (React Flow) is lazy-loaded so its bundle stays out of the list view and
 * only loads when the Dependencies lens is opened. Client-only (`ssr: false`) — the canvas measures
 * the DOM and has no meaningful server render.
 */
const ProjectGraphPanel = dynamic(
  () => import('@/components/canvas/project-graph-panel').then((m) => m.ProjectGraphPanel),
  { ssr: false },
);

/** The three projections of the same portfolio rows. */
type Lens = 'list' | 'dependencies' | 'timeline';

/** The URL search param the active lens is persisted in. */
const LENS_PARAM = 'lens';
/** Every lens id, for validating what arrives in the URL. */
const LENSES: readonly Lens[] = ['list', 'dependencies', 'timeline'];

/**
 * Read the active lens out of the URL, falling back to the list.
 *
 * @remarks
 * The lens belongs in the URL for the same reason the filters do: a configured surface has to
 * survive a reload and be shareable as a link. It was component state, so a reload silently threw
 * the viewer back to the list — and the timeline's own zoom and scale, which *are* persisted,
 * became unreachable by link because the lens showing them was not.
 *
 * @param params - The current search params.
 * @returns the parsed lens.
 */
function parseLens(params: URLSearchParams): Lens {
  const raw = params.get(LENS_PARAM);
  return LENSES.find((lens) => lens === raw) ?? 'list';
}

const HEALTH_LABEL = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
} as const;
const HEALTH_CLASS = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-destructive',
} as const;
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
}

function progressPercent(item: ProjectOverviewItem): number {
  return item.taskCount === 0 ? 0 : Math.round((item.completedTaskCount / item.taskCount) * 100);
}

/**
 * Format an epoch-ms instant as the `YYYY-MM-DD` the Project date fields accept.
 *
 * @remarks
 * Formatted in UTC to match how the timeline snaps drags. Going through a local-time formatter
 * here would shift the date by a day for viewers west of UTC — the same class of bug the old
 * timeline shipped when it parsed date-only strings as local time.
 */
function toWireDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ProjectIdentity({
  item,
  orgId,
  pending,
  onDisplayChange,
  canRename,
  onRename,
  onOpen,
}: {
  item: ProjectOverviewItem;
  orgId: string;
  pending: boolean;
  onDisplayChange: (
    iconKey: EntityDisplayIconKey,
    colorKey: EntityDisplayColorKey,
    customColor: string | null,
  ) => void;
  canRename: boolean;
  onRename: (projectId: string, name: string) => void;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="relative z-10 shrink-0">
        <InitiativeIconPicker
          display={item.display}
          initiativeName={item.name}
          editable
          pending={pending}
          onChange={onDisplayChange}
        />
      </span>
      <div className="min-w-0">
        {canRename ? (
          // Editable rows: the title double-clicks to rename and single-clicks to open. It can't
          // also be the row's stretched navigation link, so opening comes through onActivate.
          <EditableTitle
            value={item.name}
            onSave={(name) => {
              onRename(item.id, name);
            }}
            canEdit
            activate="doubleClick"
            onActivate={() => {
              onOpen(item.id);
            }}
            ariaLabel="Project name"
            className="text-on-surface line-clamp-1 text-sm leading-5 font-semibold"
          />
        ) : (
          // Read-only rows keep the whole-row stretched navigation link.
          <Link
            href={`/orgs/${orgId}/projects/${item.id}`}
            className={cn(
              'text-on-surface line-clamp-1 text-sm leading-5 font-semibold hover:underline',
              STRETCHED_LINK,
            )}
          >
            {item.name}
          </Link>
        )}
        {item.summary ? (
          <p className="text-on-surface-variant mt-0.5 line-clamp-2 max-w-[52ch] text-xs leading-4">
            {item.summary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ListLens({
  applied,
  orgId,
  displayPending,
  onDisplayChange,
  onPrefetch,
  canRename,
  onRename,
  onOpen,
}: {
  applied: AppliedView<ProjectOverviewItem>;
  orgId: string;
  displayPending: boolean;
  onDisplayChange: (
    projectId: string,
    iconKey: EntityDisplayIconKey,
    colorKey: EntityDisplayColorKey,
    customColor: string | null,
  ) => void;
  onPrefetch: (projectId: string) => void;
  canRename: boolean;
  onRename: (projectId: string, name: string) => void;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  // Render one project row. Shared by the flat and grouped renders so a group band never diverges
  // from an ungrouped row.
  const renderRow = (item: ProjectOverviewItem): JSX.Element => {
    const percent = progressPercent(item);
    // The row is the drag source for the whole Project: pressing anywhere inside it — the icon,
    // the title, any metadata cell — starts the same drag.
    const dragProps = dragSourceProps(
      entityDragSource({
        kind: 'project',
        id: item.id,
        organizationId: item.organizationId,
        title: item.name,
      }),
    );
    return (
      <div
        key={item.id}
        role="row"
        {...dragProps}
        className={cn(
          'hover:bg-surface-container-high relative grid min-h-[72px] cursor-pointer grid-cols-[minmax(25rem,1fr)_7rem_7rem_7rem_7rem_8rem] items-center rounded-lg transition-colors',
          dragProps?.className,
        )}
        onMouseEnter={() => {
          onPrefetch(item.id);
        }}
      >
        <div role="gridcell" className="min-w-0 px-2 py-2">
          <ProjectIdentity
            item={item}
            orgId={orgId}
            pending={displayPending}
            onDisplayChange={(iconKey, colorKey, customColor) => {
              onDisplayChange(item.id, iconKey, colorKey, customColor);
            }}
            canRename={canRename}
            onRename={onRename}
            onOpen={onOpen}
          />
        </div>
        <div role="gridcell" className="px-3">
          <ProjectStatusBadge status={item.status} />
        </div>
        <div role="gridcell" className="px-3 whitespace-nowrap">
          {item.health ? (
            <span className={`${HEALTH_CLASS[item.health]} font-medium`}>
              {HEALTH_LABEL[item.health]}
            </span>
          ) : (
            <span className="text-on-surface-variant">—</span>
          )}
        </div>
        <div role="gridcell" className="px-3 whitespace-nowrap tabular-nums">
          {formatDate(item.targetDate)}
        </div>
        <div role="gridcell" className="px-3">
          <span className="tabular-nums">{percent}%</span>
          <div className="bg-surface-container-highest mt-1 h-1 w-14 overflow-hidden rounded-full">
            <span
              className="bg-primary block h-full rounded-full"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <div
          role="gridcell"
          className="text-on-surface-variant flex items-center gap-1 px-3 tabular-nums"
        >
          <Workflow aria-hidden className="size-4" />
          {item.blockedByIds.length > 0 ? `${item.blockedByIds.length} upstream` : 'Clear'}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto overscroll-x-contain pb-1">
      <div role="grid" aria-label="Projects" className="min-w-[61rem] text-sm">
        <div
          role="row"
          className="text-on-surface-variant grid h-9 grid-cols-[minmax(25rem,1fr)_7rem_7rem_7rem_7rem_8rem] items-center text-xs"
        >
          <div role="columnheader" className="px-3 pl-14 font-medium">
            Project
          </div>
          <div role="columnheader" className="px-3 font-medium">
            Status
          </div>
          <div role="columnheader" className="px-3 font-medium">
            Health
          </div>
          <div role="columnheader" className="px-3 font-medium">
            Target
          </div>
          <div role="columnheader" className="px-3 font-medium">
            Progress
          </div>
          <div role="columnheader" className="px-3 font-medium">
            Dependencies
          </div>
        </div>
        {/*
          Grouping is rendered, not discarded. This lens previously flattened `applied.groups` into
          bare rows, so choosing "Group by → Team" changed nothing on screen and the toolbar quietly
          lied about the state of the list.
        */}
        {applied.groups
          ? applied.groups.map((group) => (
              <div key={group.id} role="rowgroup">
                <div
                  role="row"
                  className="bg-surface-container mt-2 flex h-9 items-center gap-2 rounded-md px-3 first:mt-0"
                >
                  <span className="text-on-surface text-xs font-semibold">{group.label}</span>
                  <span className="text-on-surface-variant text-[11px] tabular-nums">
                    {group.rows.length}
                  </span>
                </div>
                {group.rows.map(renderRow)}
              </div>
            ))
          : applied.rows.map(renderRow)}
      </div>
    </div>
  );
}

/** Dense Project portfolio with list, dependency, and timeline lenses. */
export default function ProjectsListClient(): JSX.Element {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const queryClient = useQueryClient();
  const prefetch = usePrefetchApi();
  const projectNoun = useVocabulary('project');
  const projectsNoun = useVocabulary('project', { plural: true });
  const teamNoun = useVocabulary('team');
  const [createOpen, setCreateOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const lens = useMemo(() => parseLens(new URLSearchParams(search)), [search]);
  const setLens = useCallback(
    (next: Lens): void => {
      const params = new URLSearchParams(search);
      if (next === 'list') params.delete(LENS_PARAM);
      else params.set(LENS_PARAM, next);
      const query = params.toString();
      // `replace`, not `push`: flipping between projections of the same rows is not a navigation
      // step, and back should leave the page rather than walk the lenses.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );
  const { state, display, setFilters, setGroupBy, setSort, setDisplay } = useViewState();

  const overviewQ = useApiQuery(projectOverviewDef(orgId));
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );
  const projects = useMemo(() => overviewQ.data?.items ?? [], [overviewQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  // A Project PATCH requires `contribute` server-side, so the inline-rename affordance is gated on
  // that same capability (the server still enforces it regardless).
  const canRename = useOrgCapability(members, roles, 'contribute');
  const leadNameById = useMemo(
    () => new Map<string, string>(members.map((member) => [member.actorId, member.displayName])),
    [members],
  );
  const teamNameById = useMemo(
    () => new Map<string, string>(teams.map((team) => [team.id, team.name])),
    [teams],
  );
  const catalog = useMemo(
    () =>
      buildProjectCatalog({
        leadLabel: 'Person',
        teamLabel: teamNoun,
        leadOptions: (): readonly FieldOption[] =>
          members.map((member) => ({ value: member.actorId, label: member.displayName })),
        resolveLead: (id) => leadNameById.get(id) ?? id,
        teamOptions: (): readonly FieldOption[] =>
          teams.map((team) => ({ value: team.id, label: team.name })),
        resolveTeam: (id) => teamNameById.get(id) ?? id,
      }),
    [leadNameById, members, teamNameById, teamNoun, teams],
  );
  const applied = useMemo(() => applyView(projects, state, catalog), [catalog, projects, state]);
  // The dependency canvas is inherently flat (it lays out a graph, not a list), so it takes the
  // flattened rows. The list and timeline lenses consume `applied` directly and render the groups.
  const rows = applied.groups ? applied.groups.flatMap((group) => group.rows) : applied.rows;
  const timelineCatalog = useMemo(
    () => buildProjectTimelineCatalog(orgId, (teamId) => teamNameById.get(teamId) ?? null),
    [orgId, teamNameById],
  );
  // The viewport is owned here, not by the canvas, so the axis controls can compose into the one
  // toolbar row above instead of forcing a second control row directly over the chart.
  const timelineSpans = useMemo(
    () =>
      projects
        .map((project) => timelineCatalog.span(project))
        .filter((span): span is NonNullable<typeof span> => span !== null),
    [projects, timelineCatalog],
  );
  const viewport = useTimelineViewport(timelineSpans, display.scale);

  const displayMutation = useApiMutation<
    EntityDisplayOut,
    {
      projectId: string;
      iconKey: EntityDisplayIconKey;
      colorKey: EntityDisplayColorKey;
      customColor: string | null;
    },
    { previous?: typeof overviewQ.data }
  >({
    mutationFn: ({ projectId, iconKey, colorKey, customColor }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'project', subjectId: projectId },
            json: { iconKey, colorKey, customColor },
          }),
        'Could not customize this project.',
      ),
    onMutate: async ({ projectId, iconKey, colorKey, customColor }) => {
      const key = [...queryKeys.projects(orgId), 'overview'] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<typeof overviewQ.data>(key);
      queryClient.setQueryData(key, (current: typeof overviewQ.data) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === projectId
                  ? {
                      ...item,
                      display: {
                        subjectType: 'project',
                        subjectId: projectId,
                        iconKey,
                        colorKey,
                        customColor,
                        customized: true,
                      },
                    }
                  : item,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous)
        queryClient.setQueryData([...queryKeys.projects(orgId), 'overview'], context.previous);
    },
    invalidateKeys: [[...queryKeys.projects(orgId), 'overview']],
  });

  const renameMutation = useApiMutation<ProjectOut, { projectId: string; name: string }>({
    mutationFn: ({ projectId, name }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: { name },
          }),
        `Could not rename this ${projectNoun.toLowerCase()}.`,
      ),
    invalidateKeys: [[...queryKeys.projects(orgId), 'overview']],
  });

  /**
   * Persist a dragged span.
   *
   * @remarks
   * Optimistic by design: the bar has already moved under the user's pointer, so the cache is
   * updated immediately and the request follows. A failure rolls the row back and surfaces an
   * inline error — the drag is never blocked, confirmed, or snapped back mid-gesture.
   */
  const rescheduleMutation = useApiMutation<
    ProjectOut,
    { projectId: string; startDate: string; targetDate: string },
    { previous?: typeof overviewQ.data }
  >({
    mutationFn: ({ projectId, startDate, targetDate }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: { startDate, targetDate },
          }),
        `Could not reschedule this ${projectNoun.toLowerCase()}.`,
      ),
    onMutate: async ({ projectId, startDate, targetDate }) => {
      const key = [...queryKeys.projects(orgId), 'overview'] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<typeof overviewQ.data>(key);
      queryClient.setQueryData(key, (current: typeof overviewQ.data) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === projectId ? { ...item, startDate, targetDate } : item,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous)
        queryClient.setQueryData([...queryKeys.projects(orgId), 'overview'], context.previous);
    },
    invalidateKeys: [[...queryKeys.projects(orgId), 'overview']],
  });

  const handleReschedule = useCallback(
    (projectId: string, span: TimelineSpan): void => {
      rescheduleMutation.mutate({
        projectId,
        startDate: toWireDate(span.start),
        targetDate: toWireDate(span.end),
      });
    },
    [rescheduleMutation],
  );

  /**
   * Apply a whole downstream ripple.
   *
   * @remarks
   * Issued as one batch so the proposal reads as a single decision; the shared overview key is
   * invalidated once at the end rather than per row.
   */
  const [applyingCascade, setApplyingCascade] = useState(false);
  const handleApplyCascade = useCallback(
    (changes: readonly ScheduleChange[]): void => {
      if (changes.length === 0) return;
      setApplyingCascade(true);
      void Promise.all(
        changes.map((change) =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].projects[':id'].$patch({
                param: { orgId, id: change.id },
                json: {
                  startDate: toWireDate(change.to.start),
                  targetDate: toWireDate(change.to.end),
                },
              }),
            `Could not reschedule a dependent ${projectNoun.toLowerCase()}.`,
          ),
        ),
      )
        .catch(() => undefined)
        .finally(() => {
          setApplyingCascade(false);
          void queryClient.invalidateQueries({
            queryKey: [...queryKeys.projects(orgId), 'overview'],
          });
        });
    },
    [orgId, projectNoun, queryClient],
  );

  const handleCreated = useCallback(
    (created: ProjectOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects(orgId) });
      router.push(`/orgs/${orgId}/projects/${created.id}`);
    },
    [orgId, queryClient, router],
  );

  const lensOptions = [
    { id: 'list' as const, label: 'List', icon: ListView },
    { id: 'dependencies' as const, label: 'Dependencies', icon: Workflow },
    { id: 'timeline' as const, label: 'Timeline', icon: GanttChart },
  ];

  return (
    <ListPageLayout
      title={projectsNoun}
      subtitle="Plan, sequence, and operate bounded work."
      actions={
        <Button
          className="min-h-10 gap-1.5"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> New {projectNoun.toLowerCase()}
        </Button>
      }
      toolbar={
        projects.length > 0 ? (
          // Two affordances: Filter (which rows) and Display (how they are arranged and drawn).
          // The lens switcher rides the bar's leading slot and the timeline's own options are
          // sections inside Display, so the surface never grows a third control row.
          <FilterToolbar
            catalog={catalog}
            state={state}
            onFiltersChange={setFilters}
            onGroupByChange={setGroupBy}
            onSortChange={setSort}
            leading={
              <div
                className="bg-surface-container-low mr-1 flex shrink-0 items-center rounded-lg p-0.5"
                aria-label="Project view"
              >
                {lensOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      size="sm"
                      variant={lens === option.id ? 'secondary' : 'ghost'}
                      className="min-h-10 gap-1.5 px-2.5 @2xl:min-h-8 @2xl:px-3"
                      aria-pressed={lens === option.id}
                      aria-label={option.label}
                      onClick={() => {
                        setLens(option.id);
                      }}
                    >
                      <Icon aria-hidden className="size-4" />
                      <span className="hidden @2xl:inline">{option.label}</span>
                    </Button>
                  );
                })}
              </div>
            }
            {...(lens === 'timeline'
              ? {
                  displayExtras: (
                    <TimelineDisplaySections
                      display={display}
                      onDisplayChange={setDisplay}
                      onToday={viewport.resetToToday}
                      onZoomIn={viewport.zoomIn}
                      onZoomOut={viewport.zoomOut}
                    />
                  ),
                }
              : {})}
          />
        ) : null
      }
      fill={lens !== 'list'}
    >
      <CreateProjectDialog
        orgId={orgId}
        projectNoun={projectNoun}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {/* placeholder: the project rows — how many projects the workspace has and each one's name,
          status, health, lead, cycle and progress. The heading, filters and "New project" action
          above are static copy and paint immediately. */}
      {overviewQ.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[72px] w-full" />
          ))}
        </div>
      ) : overviewQ.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(overviewQ.error, 'Could not load projects.')}
        </p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={`No ${projectsNoun.toLowerCase()} yet`}
          body="Create a bounded effort to coordinate people, tasks, dependencies, and delivery."
          cta={{
            label: `Create your first ${projectNoun.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={`No matching ${projectsNoun.toLowerCase()}`}
          body="Adjust the current filters to see more work."
        />
      ) : (
        <section
          className="relative flex min-h-0 flex-1 flex-col"
          aria-label={`${projectsNoun} ${lens} view`}
        >
          {lens === 'list' ? (
            <ListLens
              applied={applied}
              orgId={orgId}
              displayPending={displayMutation.isPending}
              onDisplayChange={(projectId, iconKey, colorKey, customColor) => {
                displayMutation.mutate({ projectId, iconKey, colorKey, customColor });
              }}
              onPrefetch={(projectId) => {
                prefetch(projectDetailDef(orgId, projectId));
              }}
              canRename={canRename}
              onRename={(projectId, name) => {
                renameMutation.mutate({ projectId, name });
              }}
              onOpen={(projectId) => {
                router.push(`/orgs/${orgId}/projects/${projectId}`);
              }}
            />
          ) : lens === 'dependencies' ? (
            <ProjectGraphPanel rows={rows} orgId={orgId} />
          ) : (
            <TimelineCanvas
              applied={applied}
              catalog={timelineCatalog}
              display={display}
              viewport={viewport}
              noun={projectNoun}
              pluralNoun={projectsNoun}
              canSchedule={canRename}
              // On this surface the timeline *is* the page, so it runs to the content panel's
              // edges rather than sitting inside the container's document gutters.
              fullBleed
              onReschedule={handleReschedule}
              onApplyCascade={handleApplyCascade}
              applyingCascade={applyingCascade}
              onActivate={(projectId) => {
                router.push(`/orgs/${orgId}/projects/${projectId}`);
              }}
              onPrefetch={(projectId) => {
                prefetch(projectDetailDef(orgId, projectId));
              }}
            />
          )}
        </section>
      )}
      {displayMutation.error ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(displayMutation.error, 'Could not customize this project.')}
        </p>
      ) : null}
    </ListPageLayout>
  );
}
