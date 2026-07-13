'use client';

import type { CalendarItemOut, CalendarLayerOut } from '@docket/types';
import { Badge, SheetDescription, SheetTitle } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { CALENDAR_ITEM_KIND_ICON, CALENDAR_ITEM_KIND_LABEL } from '../calendar-item-card';
import { CoreFieldsForm } from './core-fields-form';
import { LinkedTasksSection } from './linked-tasks-section';
import { itemTimeLabel } from './presentation';
import { CalendarItemRelationsSection } from './relations-section';
import { DeleteCalendarItemAction, SyncStatusSection } from './status-actions';

/** Props for {@link CalendarItemWorkspace}. */
export interface CalendarItemWorkspaceProps {
  /** Loaded calendar item to render. */
  item: CalendarItemOut;
  /** Owning layer, used for color, title, and provider context. */
  layer?: CalendarLayerOut;
  /** Close the drawer after deletion. */
  onClose: () => void;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
  /** Open another calendar item in the drawer. */
  onOpenItem: (itemId: string) => void;
}

/** Composed workspace body for one loaded calendar item. */
export function CalendarItemWorkspace({
  item,
  layer,
  onClose,
  onOpenTask,
  onOpenItem,
}: CalendarItemWorkspaceProps): JSX.Element {
  const KindIcon = CALENDAR_ITEM_KIND_ICON[item.kind];
  const attendeeCount = item.attendees.length;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 [&_svg]:size-5"
            style={{ color: layer?.color ?? undefined }}
          >
            <KindIcon />
          </span>
          <SheetTitle className="text-on-surface min-w-0 flex-1 text-base font-semibold">
            {item.title}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Calendar item details, relationships, and linked tasks.
          </SheetDescription>
        </div>
        <p className="text-on-surface-variant text-sm">{itemTimeLabel(item)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {layer ? (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
              />
              {layer.title}
            </Badge>
          ) : null}
          <Badge variant="secondary" className="font-normal">
            {CALENDAR_ITEM_KIND_LABEL[item.kind]}
          </Badge>
          {item.htmlLink ? (
            <a
              href={item.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-xs hover:underline"
            >
              Open in provider
            </a>
          ) : null}
        </div>
      </header>

      <SyncStatusSection item={item} />

      <section className="flex flex-col gap-2">
        <h3 className="text-on-surface text-sm font-semibold">Details</h3>
        <CoreFieldsForm item={item} />
      </section>

      <CalendarItemRelationsSection itemId={item.id} onOpenItem={onOpenItem} />
      <LinkedTasksSection item={item} onOpenTask={onOpenTask} />

      <section className="flex flex-col gap-1.5">
        <h3 className="text-on-surface text-sm font-semibold">Provider metadata</h3>
        <p className="text-on-surface-variant text-xs">
          {[
            layer?.provider ? `Provider: ${layer.provider}` : null,
            layer?.accessRole ? `Access: ${layer.accessRole}` : null,
            (item.organizer?.displayName ?? item.organizer?.email)
              ? `Organizer: ${item.organizer.displayName ?? item.organizer.email}`
              : null,
            attendeeCount > 0
              ? `${String(attendeeCount)} attendee${attendeeCount === 1 ? '' : 's'}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'No provider metadata.'}
        </p>
      </section>

      <div className="mt-auto flex justify-between border-t pt-3">
        <DeleteCalendarItemAction item={item} onDeleted={onClose} />
      </div>
    </div>
  );
}
