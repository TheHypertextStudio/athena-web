'use client';

import type { CalendarItemRelationOut } from '@docket/types';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useApiListQuery } from '@/lib/query';

import { CALENDAR_ITEM_KIND_LABEL } from '../calendar-item-card';
import { calendarItemRelationsDef } from '../calendar-data';
import { useDetachCalendarItemRelation } from '../calendar-mutations';

/** Props for {@link CalendarItemRelationsSection}. */
export interface CalendarItemRelationsSectionProps {
  /** Calendar item whose outgoing relationships are shown. */
  itemId: string;
  /** Open a related calendar item in the same drawer surface. */
  onOpenItem: (itemId: string) => void;
}

/** Contents and related-item groups for one calendar item. */
export function CalendarItemRelationsSection({
  itemId,
  onOpenItem,
}: CalendarItemRelationsSectionProps): JSX.Element {
  const relationsQuery = useApiListQuery(calendarItemRelationsDef(itemId));
  const contained = relationsQuery.data?.items.filter((relation) => relation.role === 'contained');
  const related = relationsQuery.data?.items.filter((relation) => relation.role === 'related');

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-on-surface text-sm font-semibold">Calendar relationships</h3>
      {relationsQuery.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ) : relationsQuery.isError ? (
        <p role="alert" className="text-destructive text-xs">
          We couldn&apos;t load related calendar items. Please try again.
        </p>
      ) : (contained?.length ?? 0) === 0 && (related?.length ?? 0) === 0 ? (
        <p className="text-on-surface-variant text-xs">No calendar items attached yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <RelationGroup
            title="Contents"
            relations={contained ?? []}
            sourceItemId={itemId}
            onOpenItem={onOpenItem}
          />
          <RelationGroup
            title="Related events"
            relations={related ?? []}
            sourceItemId={itemId}
            onOpenItem={onOpenItem}
          />
        </div>
      )}
    </section>
  );
}

interface RelationGroupProps {
  title: string;
  relations: readonly CalendarItemRelationOut[];
  sourceItemId: string;
  onOpenItem: (itemId: string) => void;
}

function RelationGroup({
  title,
  relations,
  sourceItemId,
  onOpenItem,
}: RelationGroupProps): JSX.Element | null {
  if (relations.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-on-surface-variant text-xs font-medium">{title}</p>
      {relations.map((relation) => (
        <RelationRow
          key={relation.targetItemId}
          relation={relation}
          sourceItemId={sourceItemId}
          onOpenItem={onOpenItem}
        />
      ))}
    </div>
  );
}

interface RelationRowProps {
  relation: CalendarItemRelationOut;
  sourceItemId: string;
  onOpenItem: (itemId: string) => void;
}

function RelationRow({ relation, sourceItemId, onOpenItem }: RelationRowProps): JSX.Element {
  const detach = useDetachCalendarItemRelation(sourceItemId, relation.targetItemId);
  const title = relation.targetTitle ?? 'Calendar item';

  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-col gap-1 rounded-md border px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onOpenItem(relation.targetItemId);
          }}
          className="focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {title}
        </button>
        {relation.targetKind ? (
          <Badge variant="secondary" className="shrink-0 font-normal">
            {CALENDAR_ITEM_KIND_LABEL[relation.targetKind]}
          </Badge>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Detach ${title}`}
          disabled={detach.isPending}
          onClick={() => {
            detach.mutate(undefined);
          }}
        >
          Detach
        </Button>
      </div>
      {detach.isError ? (
        <p role="alert" className="text-destructive text-xs">
          We couldn&apos;t remove this relationship. Please try again.
        </p>
      ) : null}
    </div>
  );
}
