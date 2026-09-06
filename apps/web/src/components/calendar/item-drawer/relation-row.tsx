'use client';

/**
 * `calendar/item-drawer/relation-row` — one other calendar item this event is tied to.
 *
 * @remarks
 * Matches {@link import('./linked-task-row').LinkedTaskRow} exactly: a tonal hover step, the title
 * as the control, and a detach affordance that stays out of the way until the row is reached. The
 * two used to draw different boxes around themselves in the same column.
 */
import type { CalendarItemRelationOut } from '@docket/planning/calendar-contract';
import { ArrowRight } from '@docket/ui/icons';
import { Badge, Button } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { CALENDAR_ITEM_KIND_LABEL } from '../item-presentation/event-identity';
import { useDetachCalendarItemRelation } from '../calendar-mutations';

/** Props for {@link RelationRow}. */
export interface RelationRowProps {
  /** The item the relationship starts from. */
  sourceItemId: string;
  /** The relationship being rendered. */
  relation: CalendarItemRelationOut;
  /** Open the related item in the same surface. */
  onOpenItem: (itemId: string) => void;
}

/** One related calendar item: open it, or take the link off. */
export function RelationRow({ sourceItemId, relation, onOpenItem }: RelationRowProps): JSX.Element {
  const detach = useDetachCalendarItemRelation(sourceItemId, relation.targetItemId);
  const title = relation.targetTitle ?? 'Calendar item';
  const kindLabel = relation.targetKind ? CALENDAR_ITEM_KIND_LABEL[relation.targetKind] : null;

  return (
    <div className="hover:bg-surface-container-high group flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-on-surface-variant shrink-0 [&_svg]:size-4">
          <ArrowRight />
        </span>
        <button
          type="button"
          onClick={() => {
            onOpenItem(relation.targetItemId);
          }}
          className="focus-visible:ring-ring text-on-surface text-body-medium min-w-0 flex-1 truncate rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          {title}
        </button>
        {kindLabel ? (
          <Badge variant="secondary" className="shrink-0">
            {kindLabel}
          </Badge>
        ) : null}
        <Button
          controlSize="xs"
          variant="ghost"
          aria-label={`Detach ${title}`}
          className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          disabled={detach.isPending}
          onClick={() => {
            detach.mutate(undefined);
          }}
        >
          Detach
        </Button>
      </div>
      {detach.isError ? (
        <p role="alert" className="text-error text-body-small">
          We couldn&apos;t remove this relationship. Please try again.
        </p>
      ) : null}
    </div>
  );
}
