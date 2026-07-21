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
import { STRETCHED_LINK } from '@docket/ui/lib/stretched-link';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { InitiativeIconPicker } from '@/components/initiatives/initiative-icon-picker';
import { CreateProjectDialog } from '@/components/projects/create-project';
import { buildProjectCatalog } from '@/components/projects/project-catalog';
import { ProjectStatusBadge } from '@/components/projects/project-status';
import { applyView } from '@/components/views/apply-view';
import type { FieldOption } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
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

/**
 * The dependency canvas (React Flow) is lazy-loaded so its bundle stays out of the list view and
 * only loads when the Dependencies lens is opened. Client-only (`ssr: false`) — the canvas measures
 * the DOM and has no meaningful server render.
 */
const ProjectGraphPanel = dynamic(
  () => import('@/components/canvas/project-graph-panel').then((m) => m.ProjectGraphPanel),
  { ssr: false },
);

type Lens = 'list' | 'dependencies' | 'timeline';

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

function ProjectIdentity({
  item,
  orgId,
  pending,
  onDisplayChange,
}: {
  item: ProjectOverviewItem;
  orgId: string;
  pending: boolean;
  onDisplayChange: (iconKey: EntityDisplayIconKey, colorKey: EntityDisplayColorKey) => void;
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
        <Link
          href={`/orgs/${orgId}/projects/${item.id}`}
          className={cn(
            'text-on-surface line-clamp-1 text-sm leading-5 font-semibold hover:underline',
            STRETCHED_LINK,
          )}
        >
          {item.name}
        </Link>
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
  rows,
  orgId,
  displayPending,
  onDisplayChange,
  onPrefetch,
}: {
  rows: readonly ProjectOverviewItem[];
  orgId: string;
  displayPending: boolean;
  onDisplayChange: (
    projectId: string,
    iconKey: EntityDisplayIconKey,
    colorKey: EntityDisplayColorKey,
  ) => void;
  onPrefetch: (projectId: string) => void;
}): JSX.Element {
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
        {rows.map((item) => {
          const percent = progressPercent(item);
          return (
            <div
              key={item.id}
              role="row"
              className="hover:bg-surface-container-high relative grid min-h-[72px] grid-cols-[minmax(25rem,1fr)_7rem_7rem_7rem_7rem_8rem] items-center rounded-lg transition-colors"
              onMouseEnter={() => {
                onPrefetch(item.id);
              }}
            >
              <div role="gridcell" className="min-w-0 px-2 py-2">
                <ProjectIdentity
                  item={item}
                  orgId={orgId}
                  pending={displayPending}
                  onDisplayChange={(iconKey, colorKey) => {
                    onDisplayChange(item.id, iconKey, colorKey);
                  }}
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
        })}
      </div>
    </div>
  );
}

function TimelineLens({
  rows,
  orgId,
}: {
  rows: readonly ProjectOverviewItem[];
  orgId: string;
}): JSX.Element {
  const dated = rows.filter((item) => Boolean(item.startDate ?? item.targetDate));
  const timestamps = dated
    .flatMap((item) =>
      [item.startDate, item.targetDate]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => new Date(value).getTime()),
    )
    .filter(Number.isFinite);
  const now = Date.now();
  const min = timestamps.length > 0 ? Math.min(...timestamps) : now;
  const max = timestamps.length > 0 ? Math.max(...timestamps) : now + 1000 * 60 * 60 * 24 * 90;
  const range = Math.max(max - min, 1000 * 60 * 60 * 24 * 30);
  const position = (value: string | null | undefined): number =>
    value ? Math.max(0, Math.min(100, ((new Date(value).getTime() - min) / range) * 100)) : 0;

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <div className="min-w-[62rem]">
        <div className="text-on-surface-variant grid h-9 grid-cols-[20rem_minmax(40rem,1fr)] items-center text-xs">
          <div className="px-3 font-medium">Project</div>
          <div className="flex justify-between px-4">
            <span>{DATE_FORMAT.format(new Date(min))}</span>
            <span>{DATE_FORMAT.format(new Date(max))}</span>
          </div>
        </div>
        {rows.map((item) => {
          const left = position(item.startDate ?? item.targetDate);
          const right = position(item.targetDate ?? item.startDate);
          return (
            <div
              key={item.id}
              className="hover:bg-surface-container-high grid min-h-[64px] grid-cols-[20rem_minmax(40rem,1fr)] items-center rounded-lg transition-colors"
            >
              <Link
                href={`/orgs/${orgId}/projects/${item.id}`}
                className="min-w-0 px-3 py-2 hover:underline"
              >
                <span className="text-on-surface block truncate text-sm font-semibold">
                  {item.name}
                </span>
                {item.summary ? (
                  <span className="text-on-surface-variant mt-0.5 line-clamp-2 text-xs leading-4">
                    {item.summary}
                  </span>
                ) : null}
              </Link>
              <div className="relative mx-4 h-7">
                <span className="bg-outline-variant/50 absolute top-1/2 right-0 left-0 h-px" />
                {item.startDate || item.targetDate ? (
                  <Link
                    href={`/orgs/${orgId}/projects/${item.id}`}
                    aria-label={`${item.name} timeline`}
                    className="bg-primary-container text-on-primary-container absolute top-1 h-5 min-w-3 rounded-full"
                    style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%` }}
                  />
                ) : (
                  <span className="text-on-surface-variant absolute top-1 text-xs">
                    Not scheduled
                  </span>
                )}
              </div>
            </div>
          );
        })}
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
  const [lens, setLens] = useState<Lens>('list');
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  const overviewQ = useApiQuery(projectOverviewDef(orgId));
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const projects = useMemo(() => overviewQ.data?.items ?? [], [overviewQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
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
  const rows = applied.groups ? applied.groups.flatMap((group) => group.rows) : applied.rows;

  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { projectId: string; iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey },
    { previous?: typeof overviewQ.data }
  >({
    mutationFn: ({ projectId, iconKey, colorKey }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'project', subjectId: projectId },
            json: { iconKey, colorKey },
          }),
        'Could not customize this project.',
      ),
    onMutate: async ({ projectId, iconKey, colorKey }) => {
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="bg-surface-container-low flex items-center rounded-lg p-1"
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
                      className="min-h-10 gap-1.5 @2xl:min-h-8"
                      aria-pressed={lens === option.id}
                      onClick={() => {
                        setLens(option.id);
                      }}
                    >
                      <Icon aria-hidden className="size-4" /> {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <FilterToolbar
              catalog={catalog}
              state={state}
              onFiltersChange={setFilters}
              onGroupByChange={setGroupBy}
              onSortChange={setSort}
            />
          </div>
        ) : null
      }
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
          className="bg-surface-container-low relative rounded-xl p-2"
          aria-label={`${projectsNoun} ${lens} view`}
        >
          {lens === 'list' ? (
            <ListLens
              rows={rows}
              orgId={orgId}
              displayPending={displayMutation.isPending}
              onDisplayChange={(projectId, iconKey, colorKey) => {
                displayMutation.mutate({ projectId, iconKey, colorKey });
              }}
              onPrefetch={(projectId) => {
                prefetch(projectDetailDef(orgId, projectId));
              }}
            />
          ) : lens === 'dependencies' ? (
            <ProjectGraphPanel rows={rows} orgId={orgId} />
          ) : (
            <TimelineLens rows={rows} orgId={orgId} />
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
