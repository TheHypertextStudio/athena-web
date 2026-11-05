'use client';

/** Find existing work first; reveal filtering and bulk selection when requested. */
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  IconButton,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Select,
  Skeleton,
} from '@docket/ui/primitives';
import { Ellipsis, Filter as FilterIcon, Plus, X } from '@docket/ui/icons';
import { EntityList, EntityListRow, InlineBanner } from '@docket/ui/components';
import { useRef, useState, type JSX } from 'react';
import Link from '@/components/docket-link';
import type { ReadyPlanningController } from './daily-planning-controller';
import type { DailyWorkScope } from './daily-planning-queries';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { formatDuration } from '@/components/time-tracking/format-duration';

type WorkItem = NonNullable<
  ReadyPlanningController['searchQ']['data']
>['pages'][number]['items'][number];

function clearTaskFilters(plan: ReadyPlanningController): void {
  plan.setWorkOrganization('');
  plan.setDueOnly(false);
  plan.setWorkScope('mine');
}

function ActiveWorkFilters({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element | null {
  const scope = {
    mine: '',
    assigned: 'Assigned to me',
    created: 'Created by me',
    all: 'All accessible tasks',
  }[plan.workScope];
  const workspace = plan.searchQ.data?.pages[0]?.workspaces.find(
    (item) => item.id === plan.workOrganization,
  )?.name;
  const labels = [scope, workspace, plan.dueOnly ? 'Due or overdue' : ''].filter(Boolean);
  if (!labels.length) return null;
  return (
    <div role="group" aria-label="Active task filters" className="flex min-w-0 items-center gap-2">
      <p className="text-label-small text-on-surface-variant min-w-0 flex-1">
        {labels.join(' · ')}
      </p>
      <IconButton
        label="Clear task filters"
        onClick={() => {
          clearTaskFilters(plan);
        }}
      >
        <X />
      </IconButton>
    </div>
  );
}
function taskSelection(item: WorkItem) {
  return {
    taskId: item.id,
    organizationId: item.organizationId,
    title: item.title,
    ...(item.estimateMinutes && item.estimateMinutes > 0
      ? { plannedMinutes: item.estimateMinutes }
      : {}),
  };
}

function WorkFilters({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const workspaces = plan.searchQ.data?.pages[0]?.workspaces ?? [];
  const count =
    Number(plan.workScope !== 'mine') +
    Number(Boolean(plan.workOrganization)) +
    Number(plan.dueOnly);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label="Filter"
          hint={count ? `Filter tasks · ${count} active` : 'Filter tasks'}
          variant={count ? 'secondary' : 'ghost'}
        >
          <FilterIcon />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" presentation="panel" width="lg" aria-label="Task filters">
        <PopoverHeader inset="compact">
          <h2 className="text-title-small text-on-surface">Filter tasks</h2>
        </PopoverHeader>
        <PopoverBody inset="compact" className="space-y-3">
          <Field label="Task scope">
            <Select
              controlSize="sm"
              value={plan.workScope}
              onChange={(event) => {
                plan.setWorkScope(event.target.value as DailyWorkScope);
              }}
            >
              <option value="mine">Assigned to me or created by me</option>
              <option value="assigned">Assigned to me</option>
              <option value="created">Created by me</option>
              <option value="all">All accessible tasks</option>
            </Select>
          </Field>
          <Field label="Workspace">
            <Select
              controlSize="sm"
              value={plan.workOrganization}
              onChange={(event) => {
                plan.setWorkOrganization(event.target.value);
              }}
            >
              <option value="">All workspaces</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="text-label-large text-on-surface flex min-h-10 items-center gap-2">
            <Checkbox
              checked={plan.dueOnly}
              onChange={(event) => {
                plan.setDueOnly(event.target.checked);
              }}
            />
            Due or overdue
          </label>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

function BrowserToolbar({
  plan,
  onSelect,
}: {
  readonly plan: ReadyPlanningController;
  readonly onSelect: () => void;
}): JSX.Element {
  const { openCreate } = useCreateObject();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex items-center gap-1">
      <Input
        type="search"
        maxLength={200}
        className="min-w-0 flex-1"
        aria-label="Search existing tasks"
        placeholder="Find a task"
        value={plan.search}
        onChange={(event) => {
          plan.setSearch(event.target.value);
        }}
      />
      <WorkFilters plan={plan} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton ref={menuTrigger} label="More task actions">
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              openCreate(
                {
                  kind: 'task',
                  sameWorkspaceCompletion: 'stay',
                  navigateAfterCreate: false,
                  afterCreate: (task) => {
                    plan.addTask(task.id, task.organizationId, task.title);
                  },
                },
                menuTrigger.current,
              );
            }}
          >
            New task
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSelect}>Select tasks</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorkFacts({
  item,
  timezone,
}: {
  readonly item: WorkItem;
  readonly timezone: string;
}): JSX.Element {
  const due = item.dueAt
    ? new Date(item.dueAt).toLocaleDateString(undefined, {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
      })
    : null;
  return (
    <span className="text-body-small text-on-surface-variant block truncate">
      {[
        item.organizationName,
        item.projectName,
        item.priority !== 'none' ? `${item.priority} priority` : null,
        due ? `Due ${due}` : null,
        item.estimateMinutes ? formatDuration(item.estimateMinutes * 60_000) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

function WorkRow({
  plan,
  item,
  bulk,
  selected,
  onSelect,
}: {
  readonly plan: ReadyPlanningController;
  readonly item: WorkItem;
  readonly bulk: boolean;
  readonly selected: boolean;
  readonly onSelect: (checked: boolean) => void;
}): JSX.Element {
  const added = plan.draft.tasks.some((task) => task.taskId === item.id);
  return (
    <EntityListRow
      interactive={false}
      className="shrink-0 items-center px-0 py-2"
      leading={
        bulk ? (
          <label className="inline-flex min-h-10 min-w-10 items-center justify-center">
            <Checkbox
              aria-label={`Select ${item.title}`}
              checked={added || selected}
              disabled={added}
              onChange={(event) => {
                onSelect(event.target.checked);
              }}
            />
          </label>
        ) : undefined
      }
      title={
        <Link
          href={`/orgs/${item.organizationId}/tasks/${item.id}`}
          className="min-w-0 truncate hover:underline"
        >
          {item.title}
        </Link>
      }
      subtitle={<WorkFacts item={item} timezone={plan.timezone} />}
      trailing={
        added ? (
          <span className="text-label-small text-on-surface-variant">In plan</span>
        ) : !bulk ? (
          <IconButton
            size="sm"
            label={`Add ${item.title}`}
            hint="Add to plan"
            onClick={() => {
              plan.addTasks([taskSelection(item)]);
            }}
          >
            <Plus />
          </IconButton>
        ) : undefined
      }
    />
  );
}

function BrowserStatus({
  plan,
  count,
  allInPlan,
}: {
  readonly plan: ReadyPlanningController;
  readonly count: number;
  readonly allInPlan: boolean;
}): JSX.Element | null {
  if (plan.searchQ.isPending)
    return (
      <div role="status" aria-label="Loading existing tasks" className="space-y-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-12 w-full" />
        ))}
      </div>
    );
  if (plan.searchQ.isError && !plan.searchQ.isFetchNextPageError)
    return (
      <InlineBanner
        tone="critical"
        title="Could not load existing tasks."
        action={{
          label: 'Retry',
          onSelect: () => {
            void plan.searchQ.refetch();
          },
        }}
      />
    );
  if (count || plan.searchQ.hasNextPage) return null;
  if (allInPlan)
    return (
      <p className="text-body-small text-on-surface-variant py-4">
        These tasks are already in your plan.
      </p>
    );
  const filtered = Boolean(
    plan.search || plan.workOrganization || plan.dueOnly || plan.workScope !== 'mine',
  );
  return (
    <div className="space-y-2 py-4">
      <p className="text-body-medium text-on-surface-variant">
        {filtered
          ? 'No tasks match these filters.'
          : 'No unfinished tasks are assigned to you or created by you.'}
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          plan.setSearch('');
          clearTaskFilters(plan);
          plan.setWorkScope(filtered ? 'mine' : 'all');
        }}
      >
        {filtered ? 'Clear filters' : 'Browse all tasks'}
      </Button>
    </div>
  );
}

function useWorkSelection(plan: ReadyPlanningController) {
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState(new Map<string, WorkItem>());
  const loaded = [
    ...new Map(
      (plan.searchQ.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const items = loaded.filter(
    (item) => plan.search.trim() || !plan.draft.tasks.some((task) => task.taskId === item.id),
  );
  const pending = [...selected.values()].filter(
    (item) => !plan.draft.tasks.some((task) => task.taskId === item.id),
  );
  return {
    bulk,
    setBulk,
    selected,
    items,
    allInPlan: loaded.length > 0 && items.length === 0,
    pending,
    cancel: (): void => {
      setSelected(new Map());
      setBulk(false);
    },
    toggle: (item: WorkItem, checked: boolean): void => {
      setSelected((current) => {
        const next = new Map(current);
        if (checked) next.set(item.id, item);
        else next.delete(item.id);
        return next;
      });
    },
    selectShown: (): void => {
      setSelected(
        (current) => new Map([...current, ...items.map((item) => [item.id, item] as const)]),
      );
    },
    add: (): void => {
      plan.addTasks(pending.map(taskSelection));
      setSelected(new Map());
      setBulk(false);
    },
  };
}

function BulkActions({
  selection,
}: {
  readonly selection: ReturnType<typeof useWorkSelection>;
}): JSX.Element | null {
  if (!selection.bulk) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={selection.selectShown}>
        Select shown tasks
      </Button>
      <Button variant="ghost" size="sm" onClick={selection.cancel}>
        Cancel selection
      </Button>
      {selection.pending.length ? (
        <Button onClick={selection.add}>
          Add {selection.pending.length} {selection.pending.length === 1 ? 'task' : 'tasks'} to plan
        </Button>
      ) : null}
    </div>
  );
}

/** Add work directly, with optional bulk selection for larger collections. */
export function ExistingWorkBrowser({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element {
  const selection = useWorkSelection(plan);
  return (
    <section aria-label="Existing tasks" className="min-w-0 space-y-3">
      <BrowserToolbar
        plan={plan}
        onSelect={() => {
          selection.setBulk(true);
        }}
      />
      <ActiveWorkFilters plan={plan} />
      <BulkActions selection={selection} />
      <BrowserStatus plan={plan} count={selection.items.length} allInPlan={selection.allInPlan} />
      {selection.items.length ? (
        <EntityList
          aria-label="Available tasks"
          className="max-h-[28rem] overflow-auto bg-transparent p-0"
        >
          {selection.items.map((item) => (
            <WorkRow
              key={item.id}
              plan={plan}
              item={item}
              bulk={selection.bulk}
              selected={selection.selected.has(item.id)}
              onSelect={(checked) => {
                selection.toggle(item, checked);
              }}
            />
          ))}
        </EntityList>
      ) : null}
      {plan.searchQ.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={plan.searchQ.isFetchingNextPage}
          onClick={() => {
            void plan.searchQ.fetchNextPage();
          }}
        >
          {plan.searchQ.isFetchingNextPage ? 'Loading tasks…' : 'Load more tasks'}
        </Button>
      ) : null}
      {plan.searchQ.isFetchNextPageError ? (
        <InlineBanner
          tone="critical"
          title="Could not load more tasks. Your selections are still here."
          action={{
            label: 'Retry',
            onSelect: () => {
              void plan.searchQ.fetchNextPage();
            },
          }}
        />
      ) : null}
    </section>
  );
}

/** Resume the legacy picker stage with the same task browser as the inline work panel. */
export function AddWorkStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <div className="space-y-4">
      <ExistingWorkBrowser plan={plan} />
      <Button
        onClick={() => {
          void plan.go('plan');
        }}
      >
        Done
      </Button>
    </div>
  );
}
