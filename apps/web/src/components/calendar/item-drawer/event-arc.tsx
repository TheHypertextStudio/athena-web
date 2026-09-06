'use client';

/**
 * `calendar/item-drawer/event-arc` — an event's work, read as a sequence.
 *
 * @remarks
 * Before, during, after, and everything merely related. The bands come from
 * {@link import('./arc-model').buildEventArc}, which sorts the roles the data has always carried.
 *
 * A band with nothing in it renders nothing at all. That is the ghost grammar's sixth rule
 * (`docs/design/ghost-grammar.md`) applied here: the drawer used to print two headings, two
 * apology sentences, and seven controls for an event with no work attached, and an empty event now
 * offers exactly one affordance.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { Skeleton, Surface } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { PlanWorkForEventForm } from '@/components/recurrence/plan-work-for-event-form';
import { useApiListQuery } from '@/lib/query';

import { calendarItemRelationsDef } from '../calendar-data';
import { AddWorkMenu } from './add-work-menu';
import { type ArcBand, buildEventArc } from './arc-model';
import { LinkedTaskRow } from './linked-task-row';
import { RelationRow } from './relation-row';
import { LinkTaskForm } from './task-forms';

/** Props for {@link EventArc}. */
export interface EventArcProps {
  /** The event whose work is being read. */
  item: CalendarItemOut;
  /** Navigate to a linked task's own page. */
  onOpenTask: (orgId: string, taskId: string) => void;
  /** Open a related calendar item in the same surface. */
  onOpenItem: (itemId: string) => void;
}

/** The whole arc: three ordered bands, plus whatever is merely related. */
export function EventArc({ item, onOpenTask, onOpenItem }: EventArcProps): JSX.Element {
  const relationsQuery = useApiListQuery(calendarItemRelationsDef(item.id));
  const [openForm, setOpenForm] = useState<'link' | 'plan' | null>(null);
  const arc = buildEventArc({
    linkedTasks: item.linkedTasks,
    relations: relationsQuery.data?.items ?? [],
  });

  return (
    <section aria-label="Work around this event" className="flex flex-col gap-4">
      {relationsQuery.isPending && item.linkedTasks.length === 0 ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-2/3 rounded-md" />
        </div>
      ) : null}
      {relationsQuery.isError ? (
        <p role="alert" className="text-error text-body-small">
          We couldn&apos;t load this event&apos;s connections. Please try again.
        </p>
      ) : null}

      {arc.bands.map((band) => (
        <ArcBandSection
          key={band.id}
          band={band}
          item={item}
          onOpenTask={onOpenTask}
          onOpenItem={onOpenItem}
          onLinkExisting={() => {
            setOpenForm('link');
          }}
          onPlanWork={() => {
            setOpenForm('plan');
          }}
        />
      ))}

      {arc.empty && !relationsQuery.isPending ? (
        <AddWorkMenu
          item={item}
          band="before"
          onLinkExisting={() => {
            setOpenForm('link');
          }}
          onPlanWork={() => {
            setOpenForm('plan');
          }}
        />
      ) : null}

      {openForm === 'link' ? (
        <LinkTaskForm
          itemId={item.id}
          onDone={() => {
            setOpenForm(null);
          }}
        />
      ) : null}
      {openForm === 'plan' ? (
        <PlanWorkForEventForm
          item={item}
          onDone={() => {
            setOpenForm(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface ArcBandSectionProps {
  band: ArcBand;
  item: CalendarItemOut;
  onOpenTask: (orgId: string, taskId: string) => void;
  onOpenItem: (itemId: string) => void;
  onLinkExisting: () => void;
  onPlanWork: () => void;
}

/** One band of the arc, or nothing when it holds nothing. */
function ArcBandSection({
  band,
  item,
  onOpenTask,
  onOpenItem,
  onLinkExisting,
  onPlanWork,
}: ArcBandSectionProps): JSX.Element | null {
  if (band.empty) return null;
  return (
    <Surface tone="well" shape="medium" pad="tight" className="flex flex-col gap-1">
      <h3 className="text-on-surface-variant text-label-medium px-2">{band.label}</h3>
      {band.tasks.map((link) => (
        <LinkedTaskRow key={link.taskId} itemId={item.id} link={link} onOpenTask={onOpenTask} />
      ))}
      {band.relations.map((relation) => (
        <RelationRow
          key={relation.targetItemId}
          sourceItemId={item.id}
          relation={relation}
          onOpenItem={onOpenItem}
        />
      ))}
      <AddWorkMenu
        item={item}
        band={band.id}
        onLinkExisting={onLinkExisting}
        onPlanWork={onPlanWork}
      />
    </Surface>
  );
}
