'use client';

/**
 * Stable public entry point for the calendar-item editor dialog.
 *
 * @remarks
 * The dialog shell owns selection and loading only. Focused sections live under `item-drawer/` so
 * editing task links, relationships, fields, or sync actions does not grow this orchestrator.
 */
import type { CalendarItemOut } from '@docket/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Skeleton,
} from '@docket/ui/primitives';
import { type JSX, useEffect, useState } from 'react';

import { useApiListQuery, useApiQuery } from '@/lib/query';
import { workLocationPlacesDef } from '@/components/work-location/work-location-data';

import { calendarItemDef, calendarLayersDef } from './calendar-data';
import { CalendarDrawerClose } from './calendar-drawer-close';
import { CalendarItemWorkspace } from './item-drawer/calendar-item-workspace';

/** Props for {@link CalendarItemDrawer}. */
export interface CalendarItemDrawerProps {
  /** Hub display timezone used by editable wall-clock fields. */
  displayTimezone: string;
  /** Calendar item id to show, or `null` to keep the drawer closed. */
  itemId: string | null;
  /**
   * Copies of an event folded into the one drawn on the grid, keyed by the drawn item's id.
   *
   * @remarks
   * Comes from the range read's dedup pass. The drawer is where a collapsed duplicate becomes
   * discoverable, which is the condition on collapsing it at all.
   */
  duplicatesByItemId?: ReadonlyMap<string, readonly CalendarItemOut[]>;
  /** Close the dialog. */
  onClose: () => void;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
  /** Optionally let the parent own navigation between related calendar items. */
  onOpenItem?: (itemId: string) => void;
}

/** Layered-calendar item editor dialog. */
export default function CalendarItemDrawer({
  displayTimezone,
  itemId,
  duplicatesByItemId,
  onClose,
  onOpenTask,
  onOpenItem,
}: CalendarItemDrawerProps): JSX.Element {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  useEffect(() => {
    setHasUnsavedChanges(false);
  }, [itemId]);
  const confirmDiscard = (): boolean => {
    if (hasUnsavedChanges && !window.confirm('Discard your unsaved calendar changes?'))
      return false;
    setHasUnsavedChanges(false);
    return true;
  };
  const requestClose = (): void => {
    if (!confirmDiscard()) return;
    onClose();
  };
  const requestOpenTask = (orgId: string, taskId: string): void => {
    if (!confirmDiscard()) return;
    onOpenTask(orgId, taskId);
  };
  return (
    <Dialog
      open={itemId !== null}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        showClose={false}
        className="max-h-[calc(100dvh-2rem)] max-w-3xl gap-0 overflow-hidden p-0"
      >
        {itemId === null ? (
          <>
            <DialogTitle className="sr-only">Calendar item</DialogTitle>
            <DialogDescription className="sr-only">Calendar item details.</DialogDescription>
          </>
        ) : (
          <CalendarItemDrawerContent
            key={itemId}
            displayTimezone={displayTimezone}
            initialItemId={itemId}
            duplicatesByItemId={duplicatesByItemId}
            onClose={requestClose}
            onDirtyChange={setHasUnsavedChanges}
            onBeforeItemChange={confirmDiscard}
            onOpenTask={requestOpenTask}
            onOpenItem={onOpenItem}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CalendarItemDrawerContentProps {
  displayTimezone: string;
  initialItemId: string;
  duplicatesByItemId?: ReadonlyMap<string, readonly CalendarItemOut[]> | undefined;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBeforeItemChange: () => boolean;
  onOpenTask: (orgId: string, taskId: string) => void;
  onOpenItem?: ((itemId: string) => void) | undefined;
}

function CalendarItemDrawerContent({
  displayTimezone,
  initialItemId,
  duplicatesByItemId,
  onClose,
  onDirtyChange,
  onBeforeItemChange,
  onOpenTask,
  onOpenItem,
}: CalendarItemDrawerContentProps): JSX.Element | null {
  const [activeItemId, setActiveItemId] = useState(initialItemId);
  const itemQuery = useApiQuery(calendarItemDef(activeItemId));
  const layersQuery = useApiListQuery(calendarLayersDef());
  const placesQuery = useApiListQuery(workLocationPlacesDef());
  const item = itemQuery.data;
  const layers = layersQuery.data?.items ?? [];
  const layer = item ? layers.find((value) => value.id === item.layerId) : undefined;
  const openItem = (nextItemId: string): void => {
    if (!onBeforeItemChange()) return;
    if (onOpenItem) onOpenItem(nextItemId);
    else setActiveItemId(nextItemId);
  };

  if (itemQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <CalendarDrawerClose label="Close calendar item" onClick={onClose} />
        <DialogTitle className="sr-only">Loading calendar item</DialogTitle>
        <DialogDescription className="sr-only">Loading calendar item details.</DialogDescription>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (itemQuery.isError) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <CalendarDrawerClose label="Close calendar item" onClick={onClose} />
        <DialogTitle className="sr-only">Calendar item error</DialogTitle>
        <DialogDescription className="sr-only">
          Calendar item details could not load.
        </DialogDescription>
        <p role="alert" className="text-error text-body-medium">
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
      layers={layers}
      duplicates={duplicatesByItemId?.get(item.id)}
      workPlaces={placesQuery.data?.items ?? []}
      onClose={onClose}
      onDirtyChange={onDirtyChange}
      onOpenTask={onOpenTask}
      onOpenItem={openItem}
    />
  ) : null;
}
