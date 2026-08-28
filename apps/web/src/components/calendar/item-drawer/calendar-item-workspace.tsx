'use client';

import type { CalendarItemOut, CalendarLayerOut, WorkPlaceOut } from '@docket/types';
import { Sparkles } from '@docket/ui/icons';
import { Badge, Button, DialogDescription, DialogTitle } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';

import {
  CALENDAR_ITEM_KIND_ICON,
  CALENDAR_ITEM_KIND_LABEL,
  READ_ONLY_REASON_LABEL,
} from '../calendar-item-card';
import { CalendarDrawerClose } from '../calendar-drawer-close';
import { CalendarItemDuplicateSources } from '../calendar-item-duplicate-sources';
import { CoreFieldsForm } from './core-fields-form';
import { LinkedTasksSection } from './linked-tasks-section';
import { itemTimeLabel } from './presentation';
import { CalendarItemRelationsSection } from './relations-section';
import { DeleteCalendarItemAction } from './status-actions';

/** Props for {@link CalendarItemWorkspace}. */
export interface CalendarItemWorkspaceProps {
  /** Hub display timezone used by editable wall-clock fields. */
  displayTimezone: string;
  /** Loaded calendar item to render. */
  item: CalendarItemOut;
  /** Owning layer, used for color, title, and provider context. */
  layer?: CalendarLayerOut | undefined;
  /** Every layer for the signed-in user, used to name the calendars a duplicate arrived on. */
  layers?: readonly CalendarLayerOut[] | undefined;
  /**
   * Copies of this event folded into the single block on the grid.
   *
   * @remarks
   * Empty for an ordinary event. Supplied so collapsing a cross-account duplicate stays
   * discoverable rather than silent — see {@link CalendarItemDuplicateSources}.
   */
  duplicates?: readonly CalendarItemOut[] | undefined;
  /** Arbitrary canonical saved places available for binding. */
  workPlaces?: readonly WorkPlaceOut[] | undefined;
  /** Close the dialog after deletion. */
  onClose: () => void;
  /** Report whether editable core fields differ from their saved values. */
  onDirtyChange: (dirty: boolean) => void;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
  /** Open another calendar item in the dialog. */
  onOpenItem: (itemId: string) => void;
}

/** Composed workspace body for one loaded calendar item. */
export function CalendarItemWorkspace({
  displayTimezone,
  item,
  layer,
  layers = [],
  duplicates = [],
  workPlaces = [],
  onClose,
  onDirtyChange,
  onOpenTask,
  onOpenItem,
}: CalendarItemWorkspaceProps): JSX.Element {
  const { openAthena } = useAthenaPanel();
  const KindIcon = CALENDAR_ITEM_KIND_ICON[item.kind];
  const providerLabel = layer?.provider === 'google' ? 'Google Calendar' : 'source calendar';
  const showKind = item.kind !== 'provider_event' && item.kind !== 'native_event';
  const readOnlyLabel = item.permissions.readOnlyReason
    ? READ_ONLY_REASON_LABEL[item.permissions.readOnlyReason]
    : item.permissions.canEditCore
      ? null
      : 'Read-only';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-outline-variant flex shrink-0 flex-col gap-2 border-b px-6 py-5 pr-16">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 [&_svg]:size-5"
            style={{ color: layer?.color ?? undefined }}
          >
            <KindIcon />
          </span>
          <DialogTitle className="text-on-surface text-title-large min-w-0 flex-1">
            {item.title}
          </DialogTitle>
          <CalendarDrawerClose label="Close calendar item" onClick={onClose} />
          <DialogDescription className="sr-only">
            Edit event details and manage related work.
          </DialogDescription>
        </div>
        <p className="text-on-surface-variant text-body-medium">
          {itemTimeLabel(item, displayTimezone)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {layer ? (
            <Badge variant="outline" className="gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
              />
              {layer.title}
            </Badge>
          ) : null}
          {showKind ? (
            <Badge variant="secondary">{CALENDAR_ITEM_KIND_LABEL[item.kind]}</Badge>
          ) : null}
          {readOnlyLabel ? <Badge variant="secondary">{readOnlyLabel}</Badge> : null}
          {item.htmlLink ? (
            <a
              href={item.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-body-small hover:underline"
            >
              Open in {providerLabel}
            </a>
          ) : null}
        </div>
      </header>

      <div
        data-testid="calendar-item-dialog-scroll"
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-5"
      >
        <CalendarItemDuplicateSources duplicates={duplicates} layers={layers} />

        <section className="flex flex-col gap-3">
          <h3 className="text-on-surface text-title-small">Event details</h3>
          <CoreFieldsForm
            displayTimezone={displayTimezone}
            item={item}
            workPlaces={workPlaces}
            onDirtyChange={onDirtyChange}
          />
        </section>

        <CalendarItemRelationsSection itemId={item.id} onOpenItem={onOpenItem} />
        <LinkedTasksSection item={item} onOpenTask={onOpenTask} />
      </div>

      <div className="border-outline-variant flex shrink-0 justify-between border-t px-6 py-3">
        <DeleteCalendarItemAction item={item} onDeleted={onClose} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          onClick={() => {
            const workspaceId = item.linkedTasks[0]?.organizationId;
            openAthena({
              ...(workspaceId ? { workspaceId } : {}),
              source: { type: 'calendar_item', id: item.id, label: item.title },
            });
          }}
        >
          <Sparkles aria-hidden="true" />
          Have Athena handle this
        </Button>
      </div>
    </div>
  );
}
