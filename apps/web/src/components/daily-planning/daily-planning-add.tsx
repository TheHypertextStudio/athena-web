'use client';

/** Searchable work picker separate from the agenda. */
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { EntityList, EntityListRow, InlineBanner } from '@docket/ui/components';
import type { JSX } from 'react';

import type { ReadyPlanningController } from './daily-planning-controller';
import { useCreateObject } from '@/components/create-object/create-object-provider';

type AvailableItem = NonNullable<ReadyPlanningController['searchQ']['data']>['items'][number];

function AvailableWorkRow({
  plan,
  item,
}: {
  readonly plan: ReadyPlanningController;
  readonly item: AvailableItem;
}): JSX.Element | null {
  const organizationId = item.organizationId;
  if (!organizationId) return null;
  const added = plan.draft.tasks.some((task) => task.taskId === item.entityId);
  return (
    <EntityListRow
      interactive={false}
      title={item.title}
      {...(item.subject ? { subtitle: item.subject.title } : {})}
      trailing={
        <Button
          variant="secondary"
          disabled={added}
          onClick={() => {
            plan.addTask(item.entityId, organizationId, item.title);
          }}
        >
          {added ? 'Added' : 'Add'}
        </Button>
      }
    />
  );
}

/** Add existing work to a planning draft without accepting it yet. */
export function AddWorkStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const { openCreate } = useCreateObject();
  const items =
    plan.searchQ.data?.items.filter(
      (item) => item.kind === 'task' && item.organizationId !== null,
    ) ?? [];
  return (
    <section className="max-w-3xl space-y-4">
      <Button
        variant="secondary"
        onClick={(event) => {
          openCreate(
            {
              kind: 'task',
              sameWorkspaceCompletion: 'stay',
              navigateAfterCreate: false,
              afterCreate: (task) => {
                plan.addTask(task.id, task.organizationId, task.title);
              },
            },
            event.currentTarget,
          );
        }}
      >
        New task
      </Button>
      <Input
        aria-label="Search available tasks"
        placeholder="Search tasks"
        value={plan.search}
        onChange={(event) => {
          plan.setSearch(event.target.value);
        }}
      />
      {plan.searchQ.isPending ? (
        <div
          role="status"
          aria-label="Loading available tasks"
          className="bg-surface-container-low space-y-2 rounded-xl p-3"
        >
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ) : null}
      {plan.searchQ.isError ? (
        <InlineBanner
          tone="critical"
          title="Could not load tasks."
          action={{
            label: 'Retry',
            onSelect: () => {
              void plan.searchQ.refetch();
            },
          }}
        />
      ) : null}
      {!plan.searchQ.isPending && !plan.searchQ.isError && items.length === 0 ? (
        <div className="bg-surface-container-low rounded-xl px-4 py-5">
          <p>No tasks found. Create a task to add work to this plan.</p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <EntityList aria-label="Available tasks">
          {items.map((item) => (
            <AvailableWorkRow key={item.id} plan={plan} item={item} />
          ))}
        </EntityList>
      ) : null}
      <Button
        onClick={() => {
          void plan.go('plan');
        }}
      >
        Done
      </Button>
    </section>
  );
}
