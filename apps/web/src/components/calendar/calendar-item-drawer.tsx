'use client';

/**
 * Stable public entry point for the calendar-item workspace drawer.
 *
 * @remarks
 * The drawer shell owns selection and loading only. Focused sections live under `item-drawer/` so
 * editing task links, relationships, fields, or sync actions does not grow this orchestrator.
 */
import { Sheet, SheetContent, SheetDescription, SheetTitle, Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useApiListQuery, useApiQuery } from '@/lib/query';

import { calendarItemDef, calendarLayersDef } from './calendar-data';
import { CalendarItemWorkspace } from './item-drawer/calendar-item-workspace';

/** Props for {@link CalendarItemDrawer}. */
export interface CalendarItemDrawerProps {
  /** Hub display timezone used by editable wall-clock fields. */
  displayTimezone: string;
  /** Calendar item id to show, or `null` to keep the drawer closed. */
  itemId: string | null;
  /** Close the drawer. */
  onClose: () => void;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
  /** Optionally let the parent own navigation between related calendar items. */
  onOpenItem?: (itemId: string) => void;
}

/** Layered-calendar item workspace drawer. */
export default function CalendarItemDrawer({
  displayTimezone,
  itemId,
  onClose,
  onOpenTask,
  onOpenItem,
}: CalendarItemDrawerProps): JSX.Element {
  return (
    <Sheet
      open={itemId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-[26rem]">
        {itemId === null ? (
          <>
            <SheetTitle className="sr-only">Calendar item</SheetTitle>
            <SheetDescription className="sr-only">Calendar item details.</SheetDescription>
          </>
        ) : (
          <CalendarItemDrawerContent
            key={itemId}
            displayTimezone={displayTimezone}
            initialItemId={itemId}
            onClose={onClose}
            onOpenTask={onOpenTask}
            onOpenItem={onOpenItem}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface CalendarItemDrawerContentProps {
  displayTimezone: string;
  initialItemId: string;
  onClose: () => void;
  onOpenTask: (orgId: string, taskId: string) => void;
  onOpenItem?: (itemId: string) => void;
}

function CalendarItemDrawerContent({
  displayTimezone,
  initialItemId,
  onClose,
  onOpenTask,
  onOpenItem,
}: CalendarItemDrawerContentProps): JSX.Element | null {
  const [activeItemId, setActiveItemId] = useState(initialItemId);
  const itemQuery = useApiQuery(calendarItemDef(activeItemId));
  const layersQuery = useApiListQuery(calendarLayersDef());
  const item = itemQuery.data;
  const layer = item
    ? layersQuery.data?.items.find((value) => value.id === item.layerId)
    : undefined;
  const openItem = (nextItemId: string): void => {
    if (onOpenItem) onOpenItem(nextItemId);
    else setActiveItemId(nextItemId);
  };

  if (itemQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <SheetTitle className="sr-only">Loading calendar item</SheetTitle>
        <SheetDescription className="sr-only">Loading calendar item details.</SheetDescription>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (itemQuery.isError) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <SheetTitle className="sr-only">Calendar item error</SheetTitle>
        <SheetDescription className="sr-only">
          Calendar item details could not load.
        </SheetDescription>
        <p role="alert" className="text-destructive text-sm">
          We couldn&apos;t load this calendar item. Please try again.
        </p>
      </div>
    );
  }
  return item ? (
    <CalendarItemWorkspace
      key={item.id}
      displayTimezone={displayTimezone}
      item={item}
      layer={layer}
      onClose={onClose}
      onOpenTask={onOpenTask}
      onOpenItem={openItem}
    />
  ) : null;
}
