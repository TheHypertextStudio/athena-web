'use client';

/** Searchable work picker separate from the agenda. */
import { Button, Card, CardContent, Input } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
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
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <strong className="block truncate">{item.title}</strong>
          {item.subject ? (
            <p className="text-on-surface-variant text-body-small">{item.subject.title}</p>
          ) : null}
        </div>
        <Button
          variant="secondary"
          disabled={added}
          onClick={() => {
            plan.addTask(item.entityId, organizationId, item.title);
          }}
        >
          {added ? 'Added' : 'Add'}
        </Button>
      </CardContent>
    </Card>
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
              onCreated: (task) => {
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
      {plan.searchQ.isPending ? <p>Loading tasks…</p> : null}
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
        <p>No tasks found.</p>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <AvailableWorkRow key={item.id} plan={plan} item={item} />
        ))}
      </div>
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
