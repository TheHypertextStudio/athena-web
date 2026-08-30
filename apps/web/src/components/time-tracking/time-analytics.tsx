'use client';

/** The private, URL-backed history surface for an individual’s actual tracked time. */
import type { TimeBreakdownBucketOut, TimeBreakdownDimension, TimeRecordOut } from '@docket/types';
import { Temporal } from '@js-temporal/polyfill';
import {
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Surface,
  surfaceToneColor,
  Text,
} from '@docket/ui/primitives';
import { ResponsiveControlGroup, type ResponsiveControlItem } from '@docket/ui/components';
import { ChevronLeft, ChevronRight, Filter, Plus, Schedule, X } from '@docket/ui/icons';
import { type JSX, useMemo, useState } from 'react';

import Link from '@/components/docket-link';
import { useActiveOrg } from '@/components/active-org';
import { DateRangePicker } from '@/components/date-picker';
import { resolveScheduleTimezone } from '@/components/scheduling';
import { api } from '@/lib/api';
import { useAppRouter } from '@/lib/interactions/navigation';
import { userErrorMessage } from '@/lib/problem';
import { useAppSearchParams } from '@/lib/app-location';
import { STALE, apiQueryOptions, queryKeys, useApiListQuery, useApiQuery } from '@/lib/query';

import { TimeAddPastDialog } from './time-add-past-dialog';
import { TimeRecordDialog } from './time-record-dialog';
import { TimeSessionList } from './time-session-list';
import { formatDuration, spokenDuration } from './format-duration';
import {
  applyTimeReviewPatch,
  navigateTimeReviewPeriod,
  parseTimeReviewState,
  resolveTimeReviewRange,
  serializeTimeReviewState,
  timeReviewApiFilters,
  type TimeReviewMeasure,
  type TimeReviewState,
} from './time-review-state';

const PERIODS = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['cycle', 'Cycle'],
  ['custom', 'Custom'],
] as const;
const DIMENSIONS: readonly (readonly [TimeBreakdownDimension, string])[] = [
  ['workspace', 'Workspace'],
  ['project', 'Project'],
  ['task', 'Task'],
  ['category', 'Category'],
  ['capture_source', 'Capture source'],
];
const MEASURES: readonly (readonly [TimeReviewMeasure, string])[] = [
  ['human', 'Human effort'],
  ['agent', 'Agent effort'],
  ['combined', 'Combined effort'],
];

function selectedMeasure(
  measures: { humanEffortMs: number; agentEffortMs: number; combinedEffortMs: number },
  measure: TimeReviewMeasure,
): number {
  if (measure === 'human') return measures.humanEffortMs;
  if (measure === 'agent') return measures.agentEffortMs;
  return measures.combinedEffortMs;
}

function stateKey(state: TimeReviewState, range: { start: string; end: string }): string {
  return `${serializeTimeReviewState(state).toString()}|${range.start}|${range.end}`;
}

/** Render one private selection and make every total lead to the records it counts. */
export function TimeAnalytics(): JSX.Element {
  const router = useAppRouter();
  const params = useAppSearchParams();
  const { orgs, activeOrgId } = useActiveOrg();
  const preferencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load your time settings.',
    ),
  );
  const timezone = resolveScheduleTimezone(preferencesQ.data?.timezone);
  const state = useMemo(
    () => parseTimeReviewState(new URLSearchParams(params.toString()), timezone),
    [params, timezone],
  );
  const cyclesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeCycles(),
      () => api.v1.time.cycles.$get(),
      'Could not load your cycles.',
      { staleTime: STALE.static },
    ),
  );
  const range = useMemo(
    () => resolveTimeReviewRange(state, timezone, cyclesQ.data?.items ?? []),
    [state, timezone, cyclesQ.data],
  );
  const query = useMemo(() => ({ ...range, ...timeReviewApiFilters(state) }), [range, state]);
  const key = stateKey(state, range);
  const [dimension, setDimension] = useState<TimeBreakdownDimension>('workspace');
  const [addOpen, setAddOpen] = useState(false);
  const [record, setRecord] = useState<TimeRecordOut | null>(null);
  const selectedWorkspace = state.workspaceId ?? activeOrgId ?? '';
  const projectsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.projects(selectedWorkspace),
      () =>
        api.v1.orgs[':orgId'].projects.$get({
          param: { orgId: selectedWorkspace },
          query: {},
        }),
      'Could not load projects for this workspace.',
      { enabled: Boolean(selectedWorkspace), staleTime: STALE.static },
    ),
  );
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(selectedWorkspace),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId: selectedWorkspace }, query: {} }),
      'Could not load tasks for this workspace.',
      { enabled: Boolean(selectedWorkspace), staleTime: STALE.static },
    ),
  );
  const categoriesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeCategories(),
      () => api.v1.time.categories.$get(),
      'Could not load time categories.',
      { staleTime: STALE.static },
    ),
  );
  const timelineQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.timeTimeline(key),
      () => api.v1.time.timeline.$get({ query }),
      'Could not load your sessions.',
      { staleTime: STALE.volatile },
    ),
  );
  const summaryQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeSummary(key),
      () => api.v1.time.summary.$get({ query }),
      'Could not load your time total.',
      { staleTime: STALE.volatile },
    ),
  );
  const breakdownQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeBreakdown(`${key}|${dimension}`),
      () => api.v1.time.breakdown.$get({ query: { ...query, groupBy: dimension } }),
      'Could not load your time breakdown.',
      { staleTime: STALE.volatile },
    ),
  );
  const total = selectedMeasure(
    summaryQ.data ?? { humanEffortMs: 0, agentEffortMs: 0, combinedEffortMs: 0 },
    state.measure,
  );
  const projects = projectsQ.data?.items ?? [];
  const tasks = tasksQ.data?.items ?? [];
  const categories = categoriesQ.data?.items ?? [];
  const cycles = cyclesQ.data?.items ?? [];
  const error = timelineQ.error ?? summaryQ.error ?? breakdownQ.error;
  const filters = activeFilters(state, orgs, projects, tasks, categories);

  function update(next: TimeReviewState): void {
    router.replace(`/time?${serializeTimeReviewState(next).toString()}`, { scroll: false });
  }
  function patch(change: Partial<TimeReviewState>): void {
    update(applyTimeReviewPatch(state, change));
  }
  function applyBucket(bucket: TimeBreakdownBucketOut): void {
    const filter = bucketFilter(dimension, bucket.key);
    if (!filter) return;
    update(applyTimeReviewPatch(state, { ...filter, view: 'sessions' }));
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <Text as="h1" token="headline-small">
            Time
          </Text>
          <Text token="body-small" tone="muted">
            Your private work history
          </Text>
        </div>
        <Button
          className="shrink-0"
          onClick={() => {
            setAddOpen(true);
          }}
        >
          <Plus aria-hidden="true" /> Add past time
        </Button>
      </div>

      <ResponsiveControlGroup
        label="Time review controls"
        overflowLabel="More time controls"
        items={timeReviewControlItems({
          state,
          cycles,
          workspaces: orgs,
          projects,
          tasks,
          categories,
          onPatch: patch,
          onState: update,
        })}
      />

      {state.period === 'custom' ? <CustomRangeControls state={state} onPatch={patch} /> : null}

      <div className="flex min-w-0 flex-wrap gap-2" aria-label="Selected filters">
        {filters.map((filter) => (
          <Chip
            key={filter.key}
            variant="filter"
            selected
            icon={<Filter aria-hidden="true" />}
            onClick={() => {
              patch(filter.clear);
            }}
          >
            {filter.label}
            <X aria-hidden="true" className="size-4" />
          </Chip>
        ))}
        {filters.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              patch({
                workspaceId: undefined,
                projectId: undefined,
                taskId: undefined,
                categoryId: undefined,
                captureSource: undefined,
              });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Surface
        tone="card"
        shape="medium"
        className="flex min-w-0 items-baseline justify-between gap-3 px-5 py-4"
      >
        <div className="min-w-0">
          <Text token="display-small" numeric aria-label={spokenDuration(total)}>
            {formatDuration(total)}
          </Text>
          <Text token="body-small" tone="muted">
            {MEASURES.find(([id]) => id === state.measure)?.[1]} · {range.label}
          </Text>
        </div>
        <div
          className={`${surfaceToneColor('canvas')} flex shrink-0 rounded-lg p-1`}
          aria-label="Time view"
        >
          {(['sessions', 'breakdown', 'now'] as const).map((view) => (
            <Button
              key={view}
              size="sm"
              variant={state.view === view ? 'secondary' : 'ghost'}
              onClick={() => {
                patch({ view });
              }}
            >
              {view === 'now' ? 'Now' : `${view[0]?.toUpperCase()}${view.slice(1)}`}
            </Button>
          ))}
        </div>
      </Surface>

      {error ? (
        <div role="alert" className="bg-error-container text-on-error-container rounded-xl p-4">
          <Text token="body-medium">
            {userErrorMessage(error, 'Could not load your selected time.')}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => void timelineQ.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!error &&
      state.view === 'sessions' &&
      (timelineQ.data?.items.length ?? 0) === 0 &&
      !timelineQ.isPending ? (
        <EmptyState
          rangeLabel={range.label}
          onAdd={() => {
            setAddOpen(true);
          }}
        />
      ) : null}
      {!error &&
      state.view === 'sessions' &&
      ((timelineQ.data?.items.length ?? 0) > 0 || timelineQ.isPending) ? (
        <TimeSessionList
          records={timelineQ.data?.items ?? []}
          measure={state.measure}
          timezone={timezone}
          loading={timelineQ.isPending}
          onOpen={setRecord}
        />
      ) : null}
      {!error && state.view === 'breakdown' ? (
        <Breakdown
          buckets={breakdownQ.data?.buckets ?? []}
          measure={state.measure}
          dimension={dimension}
          loading={breakdownQ.isPending}
          onDimension={setDimension}
          onChoose={applyBucket}
        />
      ) : null}
      {!error && state.view === 'now' ? <NowView records={timelineQ.data?.items ?? []} /> : null}
      <TimeAddPastDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        timezone={timezone}
        workspaceId={state.workspaceId}
        workspaces={orgs}
      />
      <TimeRecordDialog
        record={record}
        timezone={timezone}
        categories={categories}
        onOpenChange={(open) => {
          if (!open) setRecord(null);
        }}
      />
    </div>
  );
}

interface TimeFilterProps {
  readonly state: TimeReviewState;
  readonly workspaces: readonly { id: string; name: string }[];
  readonly projects: readonly { id: string; name: string }[];
  readonly tasks: readonly { id: string; title: string; projectId?: string | null | undefined }[];
  readonly categories: readonly { id: string; name: string }[];
  readonly cycles: readonly {
    id: string;
    workspaceId: string;
    workspaceName: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }[];
  readonly onPatch: (patch: Partial<TimeReviewState>) => void;
  readonly onState: (state: TimeReviewState) => void;
}

function TimeFilterItems({
  state,
  workspaces,
  projects,
  tasks,
  categories,
  cycles,
  onPatch,
  onState,
}: TimeFilterProps): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Show</DropdownMenuLabel>
      {MEASURES.map(([id, label]) => (
        <DropdownMenuItem
          key={id}
          onSelect={() => {
            onPatch({ measure: id });
          }}
        >
          {state.measure === id ? '✓ ' : ''}
          {label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Workspace</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => {
                onPatch({ workspaceId: workspace.id });
              }}
            >
              {state.workspaceId === workspace.id ? '✓ ' : ''}
              {workspace.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {state.workspaceId ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Project</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => {
                  onPatch({ projectId: project.id });
                }}
              >
                {state.projectId === project.id ? '✓ ' : ''}
                {project.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {state.projectId ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Task</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {tasks
              .filter((task) => task.projectId === state.projectId)
              .map((task) => (
                <DropdownMenuItem
                  key={task.id}
                  onSelect={() => {
                    onPatch({ taskId: task.id });
                  }}
                >
                  {state.taskId === task.id ? '✓ ' : ''}
                  {task.title}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Category</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {categories.map((category) => (
            <DropdownMenuItem
              key={category.id}
              onSelect={() => {
                onPatch({ categoryId: category.id });
              }}
            >
              {state.categoryId === category.id ? '✓ ' : ''}
              {category.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Capture source</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {(['live', 'manual', 'reconstructed', 'agent'] as const).map((source) => (
            <DropdownMenuItem
              key={source}
              onSelect={() => {
                onPatch({ captureSource: source });
              }}
            >
              {state.captureSource === source ? '✓ ' : ''}
              {`${source[0]?.toUpperCase()}${source.slice(1)}`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Cycle period</DropdownMenuLabel>
      {cycles.map((cycle) => (
        <DropdownMenuItem
          key={cycle.id}
          onSelect={() => {
            onState(
              applyTimeReviewPatch(state, {
                period: 'cycle',
                cycleId: cycle.id,
                workspaceId: cycle.workspaceId,
              }),
            );
          }}
        >
          {cycle.workspaceName} · {cycle.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function TimeFilterMenu(props: TimeFilterProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="secondary">
          <Filter aria-hidden="true" /> Filters
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <TimeFilterItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TimeFilterOverflow(props: TimeFilterProps): JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Filters</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <TimeFilterItems {...props} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CyclePeriodItems({
  state,
  cycles,
  onState,
}: Pick<TimeFilterProps, 'state' | 'cycles' | 'onState'>): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Choose a cycle</DropdownMenuLabel>
      {cycles.map((cycle) => (
        <DropdownMenuItem
          key={cycle.id}
          onSelect={() => {
            onState(
              applyTimeReviewPatch(state, {
                period: 'cycle',
                cycleId: cycle.id,
                workspaceId: cycle.workspaceId,
              }),
            );
          }}
        >
          {cycle.workspaceName} · {cycle.name}
        </DropdownMenuItem>
      ))}
      {cycles.length === 0 ? (
        <DropdownMenuItem disabled>No cycles are available to you.</DropdownMenuItem>
      ) : null}
    </>
  );
}

function CyclePeriodMenu({
  state,
  selected,
  cycles,
  onState,
}: Pick<TimeFilterProps, 'state' | 'cycles' | 'onState'> & {
  readonly selected: boolean;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={selected ? 'secondary' : 'ghost'}>
          Cycle
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <CyclePeriodItems state={state} cycles={cycles} onState={onState} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CyclePeriodOverflow(
  props: Pick<TimeFilterProps, 'state' | 'cycles' | 'onState'>,
): JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Cycle</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <CyclePeriodItems {...props} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function timeReviewControlItems(props: TimeFilterProps): readonly ResponsiveControlItem[] {
  const selectPeriod = (period: (typeof PERIODS)[number][0]): void => {
    props.onPatch(
      period === 'custom'
        ? {
            period,
            start: props.state.anchor,
            end: Temporal.PlainDate.from(props.state.anchor).add({ days: 1 }).toString(),
          }
        : { period },
    );
  };
  const periodItems = PERIODS.map(([id, label]) => ({
    id: `period-${id}`,
    priority: id === props.state.period ? 0 : 3,
    alwaysVisible: id === props.state.period,
    inline:
      id === 'cycle' ? (
        <CyclePeriodMenu
          state={props.state}
          selected={id === props.state.period}
          cycles={props.cycles}
          onState={props.onState}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant={id === props.state.period ? 'secondary' : 'ghost'}
          onClick={() => {
            selectPeriod(id);
          }}
        >
          {label}
        </Button>
      ),
    overflow:
      id === 'cycle' ? (
        <CyclePeriodOverflow state={props.state} cycles={props.cycles} onState={props.onState} />
      ) : (
        <DropdownMenuItem
          onSelect={() => {
            selectPeriod(id);
          }}
        >
          {label}
        </DropdownMenuItem>
      ),
  }));

  return [
    ...periodItems,
    {
      id: 'previous',
      priority: 1,
      inline: (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Previous ${props.state.period}`}
          onClick={() => {
            props.onState(navigateTimeReviewPeriod(props.state, -1));
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
      ),
      overflow: (
        <DropdownMenuItem
          onSelect={() => {
            props.onState(navigateTimeReviewPeriod(props.state, -1));
          }}
        >
          Previous {props.state.period}
        </DropdownMenuItem>
      ),
    },
    {
      id: 'next',
      priority: 1,
      inline: (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Next ${props.state.period}`}
          onClick={() => {
            props.onState(navigateTimeReviewPeriod(props.state, 1));
          }}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      ),
      overflow: (
        <DropdownMenuItem
          onSelect={() => {
            props.onState(navigateTimeReviewPeriod(props.state, 1));
          }}
        >
          Next {props.state.period}
        </DropdownMenuItem>
      ),
    },
    {
      id: 'filters',
      priority: 2,
      inline: <TimeFilterMenu {...props} />,
      overflow: <TimeFilterOverflow {...props} />,
    },
  ];
}

function CustomRangeControls({
  state,
  onPatch,
}: {
  readonly state: TimeReviewState;
  readonly onPatch: (patch: Partial<TimeReviewState>) => void;
}): JSX.Element {
  const end = state.end ?? Temporal.PlainDate.from(state.anchor).add({ days: 1 }).toString();
  const through = Temporal.PlainDate.from(end).subtract({ days: 1 }).toString();
  return (
    <Surface tone="card" shape="medium" pad="comfortable" className="flex min-w-0 items-end gap-3">
      <DateRangePicker
        value={{ start: state.start ?? state.anchor, end: through }}
        startPlaceholder="From"
        endPlaceholder="Through"
        startLabel="From"
        endLabel="Through"
        ariaLabel="Custom time range"
        triggerVariant="outline"
        onChange={(next) => {
          const start = next.start ?? next.end ?? state.start ?? state.anchor;
          const inclusiveEnd = next.end ?? next.start ?? through;
          onPatch({
            start,
            end: Temporal.PlainDate.from(inclusiveEnd).add({ days: 1 }).toString(),
          });
        }}
      />
    </Surface>
  );
}

function activeFilters(
  state: TimeReviewState,
  workspaces: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
  tasks: readonly { id: string; title: string }[],
  categories: readonly { id: string; name: string }[],
): { key: string; label: string; clear: Partial<TimeReviewState> }[] {
  const output: { key: string; label: string; clear: Partial<TimeReviewState> }[] = [];
  const push = (
    key: string,
    id: string | undefined,
    label: string | undefined,
    clear: Partial<TimeReviewState>,
  ): void => {
    if (id) output.push({ key, label: label ?? 'Selected filter', clear });
  };
  push(
    'workspace',
    state.workspaceId,
    workspaces.find((entry) => entry.id === state.workspaceId)?.name,
    { workspaceId: undefined, projectId: undefined, taskId: undefined },
  );
  push('project', state.projectId, projects.find((entry) => entry.id === state.projectId)?.name, {
    projectId: undefined,
    taskId: undefined,
  });
  push('task', state.taskId, tasks.find((entry) => entry.id === state.taskId)?.title, {
    taskId: undefined,
  });
  push(
    'category',
    state.categoryId,
    categories.find((entry) => entry.id === state.categoryId)?.name,
    { categoryId: undefined },
  );
  push(
    'source',
    state.captureSource,
    state.captureSource
      ? `${state.captureSource[0]?.toUpperCase()}${state.captureSource.slice(1)}`
      : undefined,
    { captureSource: undefined },
  );
  return output;
}

function bucketFilter(
  dimension: TimeBreakdownDimension,
  key: string,
): Partial<TimeReviewState> | null {
  if (key.startsWith('unassigned:')) return null;
  if (dimension === 'workspace') return { workspaceId: key };
  if (dimension === 'project') return { projectId: key };
  if (dimension === 'task') return { taskId: key };
  if (dimension === 'category') return { categoryId: key };
  if (dimension === 'capture_source') {
    if (key === 'live' || key === 'manual' || key === 'reconstructed' || key === 'agent') {
      return { captureSource: key };
    }
    return null;
  }
  return null;
}

function Breakdown({
  buckets,
  measure,
  dimension,
  loading,
  onDimension,
  onChoose,
}: {
  readonly buckets: readonly TimeBreakdownBucketOut[];
  readonly measure: TimeReviewMeasure;
  readonly dimension: TimeBreakdownDimension;
  readonly loading: boolean;
  readonly onDimension: (dimension: TimeBreakdownDimension) => void;
  readonly onChoose: (bucket: TimeBreakdownBucketOut) => void;
}): JSX.Element {
  const visible = buckets.filter((bucket) => selectedMeasure(bucket.measures, measure) > 0);
  const maximum = Math.max(
    ...visible.map((bucket) => selectedMeasure(bucket.measures, measure)),
    0,
  );
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <ResponsiveControlGroup
        label="Breakdown dimension"
        overflowLabel="More breakdown dimensions"
        items={DIMENSIONS.map(([id, label]) => ({
          id,
          priority: id === dimension ? 0 : 1,
          alwaysVisible: id === dimension,
          inline: (
            <Button
              type="button"
              size="sm"
              variant={dimension === id ? 'secondary' : 'ghost'}
              onClick={() => {
                onDimension(id);
              }}
            >
              {label}
            </Button>
          ),
          overflow: (
            <DropdownMenuItem
              onSelect={() => {
                onDimension(id);
              }}
            >
              {label}
            </DropdownMenuItem>
          ),
        }))}
      />
      {loading ? (
        <Text token="body-medium" tone="muted">
          Loading breakdown…
        </Text>
      ) : visible.length === 0 ? (
        <Text token="body-medium" tone="muted">
          No {MEASURES.find(([id]) => id === measure)?.[1].toLowerCase()} to break down in this
          period.
        </Text>
      ) : (
        <ul className="flex flex-col" aria-label={`Time by ${dimension}`}>
          {visible.map((bucket) => {
            const duration = selectedMeasure(bucket.measures, measure);
            const share = maximum > 0 ? Math.max(2, (duration / maximum) * 100) : 0;
            return (
              <li key={bucket.key}>
                <button
                  type="button"
                  onClick={() => {
                    onChoose(bucket);
                  }}
                  className="hover:bg-surface-container-low focus-visible:outline-primary focus-visible:outline-inset flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-left focus-visible:outline-2"
                >
                  <span className="min-w-0 flex-1">
                    <Text token="body-medium" truncate>
                      {bucket.label}
                    </Text>
                    <span
                      aria-hidden="true"
                      className={`${surfaceToneColor('floating')} mt-1 block h-1 overflow-hidden rounded-full`}
                    >
                      <span
                        className="bg-primary block h-full rounded-full"
                        style={{ width: `${share}%` }}
                      />
                    </span>
                  </span>
                  <Text token="label-large" numeric className="w-20 shrink-0 text-right">
                    {formatDuration(duration)}
                  </Text>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NowView({ records }: { readonly records: readonly TimeRecordOut[] }): JSX.Element {
  const active = records.find((record) => record.status === 'open' || record.status === 'paused');
  return (
    <Surface tone="card" shape="medium" className="flex flex-col items-start gap-3 p-5">
      <Text token="title-medium">
        {active ? active.title || 'Tracking now' : 'No timer running'}
      </Text>
      <Text token="body-medium" tone="muted">
        {active
          ? 'Use Focus to pause, switch, or stop your timer.'
          : 'Start a timer from Focus or any task when you are ready.'}
      </Text>
      <Button variant="secondary" asChild>
        <Link href="/today">Go find something to work on</Link>
      </Button>
    </Surface>
  );
}

function EmptyState({
  rangeLabel,
  onAdd,
}: {
  readonly rangeLabel: string;
  readonly onAdd: () => void;
}): JSX.Element {
  return (
    <Surface
      tone="card"
      shape="medium"
      className="flex min-w-0 flex-col items-start gap-3 px-6 py-10"
    >
      <Schedule aria-hidden="true" className="text-on-surface-variant size-6" />
      <Text token="title-medium">No time tracked for {rangeLabel}</Text>
      <Text as="p" token="body-medium" tone="muted" className="max-w-prose">
        There are no sessions in this selected period. Add time you already worked, or start a timer
        from the work you are doing now.
      </Text>
      <Button variant="secondary" onClick={onAdd}>
        <Plus aria-hidden="true" /> Add past time
      </Button>
    </Surface>
  );
}
