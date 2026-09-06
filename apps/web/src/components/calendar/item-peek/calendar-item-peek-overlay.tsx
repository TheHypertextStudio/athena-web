'use client';

/**
 * `calendar/item-peek/calendar-item-peek-overlay` — the host that puts a peek beside its block.
 *
 * @remarks
 * Both event surfaces mount this, so the calendar grid and the agenda rail answer a click the same
 * way. It anchors with `PopoverAnchor` and no `PopoverTrigger`, the pattern the pickers already
 * use, because the control that opened the peek lives inside a scrolling canvas while the panel
 * belongs to the overlay layer.
 *
 * The delete confirmation is a sibling of the popover rather than a child. A confirmation portals
 * outside the popover's subtree, so opening one from inside would register as an outside press and
 * unmount the popover and the confirmation together.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { useMediaQuery } from '@docket/ui/hooks';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Popover,
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  type PopoverVirtualAnchorRef,
} from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { useApiListQuery } from '@/lib/query';

import { calendarLayersDef } from '../calendar-data';
import { CalendarItemDeleteDialog } from '../item-drawer/status-actions';
import { CalendarItemPeek } from './calendar-item-peek';

/** Below this width an anchored 352px panel cannot sit beside anything, so the peek becomes a sheet. */
const ANCHORED_PEEK_QUERY = '(min-width: 40rem)';

/** Props for {@link CalendarItemPeekOverlay}. */
export interface CalendarItemPeekOverlayProps {
  /** The event to preview; `undefined` renders nothing. */
  item: CalendarItemOut | undefined;
  /** Hub display timezone the times are read in. */
  displayTimezone: string;
  /** Geometry the panel points at, owned by the calling surface's selection state. */
  anchorRef: PopoverVirtualAnchorRef;
  /** Escalate to the full event detail. */
  onOpenDetail: () => void;
  /** Close the peek and return focus to the block. */
  onClose: () => void;
  /** Record that an outside press dismissed the peek, so the canvas can ignore that same click. */
  onDismissOutside: () => void;
}

/**
 * Anchored preview of one calendar event, with a sheet fallback on narrow viewports.
 *
 * @remarks
 * A guard around the peek, and the owner of the delete confirmation. Every calendar and agenda
 * render mounts this, so with nothing open it must cost nothing — no layer read, and no dependency
 * on the Athena panel provider.
 *
 * The confirmation lives here rather than inside the peek for two reasons. A confirmation portals
 * outside the popover's subtree, so raising one from within would register as an outside press and
 * dismiss the popover under it. And the peek closes as the confirmation opens, which would take a
 * nested dialog down with it — so this level keeps its own reference to the event being deleted.
 *
 * @param props - The {@link CalendarItemPeekOverlayProps}.
 * @returns the peek and any pending confirmation.
 */
export function CalendarItemPeekOverlay({
  item,
  onClose,
  ...rest
}: CalendarItemPeekOverlayProps): JSX.Element | null {
  const [pendingDelete, setPendingDelete] = useState<CalendarItemOut | null>(null);
  return (
    <>
      {item ? (
        <OpenCalendarItemPeek
          item={item}
          onClose={onClose}
          onRequestDelete={() => {
            onClose();
            setPendingDelete(item);
          }}
          {...rest}
        />
      ) : null}
      {pendingDelete ? (
        <CalendarItemDeleteDialog
          item={pendingDelete}
          open
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          onDeleted={() => {
            setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}

interface OpenCalendarItemPeekProps extends Omit<CalendarItemPeekOverlayProps, 'item'> {
  readonly item: CalendarItemOut;
  readonly onRequestDelete: () => void;
}

function OpenCalendarItemPeek({
  item,
  displayTimezone,
  anchorRef,
  onOpenDetail,
  onClose,
  onDismissOutside,
  onRequestDelete,
}: OpenCalendarItemPeekProps): JSX.Element {
  const anchored = useMediaQuery(ANCHORED_PEEK_QUERY);
  const titleId = useId();
  const { openAthena } = useAthenaPanel();
  const layersQuery = useApiListQuery(calendarLayersDef());
  const layer = layersQuery.data?.items.find((candidate) => candidate.id === item.layerId);

  const askAthena = (): void => {
    const workspaceId = item.linkedTasks[0]?.organizationId;
    onClose();
    openAthena({
      ...(workspaceId ? { workspaceId } : {}),
      source: { type: 'calendar_item', id: item.id, label: item.title },
    });
  };

  const body = (
    <CalendarItemPeek
      item={item}
      layer={layer}
      displayTimezone={displayTimezone}
      titleId={titleId}
      onOpenDetail={onOpenDetail}
      onAskAthena={askAthena}
      onRequestDelete={onRequestDelete}
    />
  );

  if (!anchored) {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent
          presentation={{ kind: 'bottom-sheet', size: 'standard', height: 'content' }}
          data-calendar-item-peek={item.id}
        >
          <DialogTitle className="sr-only">{item.title}</DialogTitle>
          <DialogDescription className="sr-only">Calendar event summary.</DialogDescription>
          <PeekRail color={layer?.color ?? null} />
          <div className="flex flex-col gap-3 px-4 py-3">{body}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        presentation="panel"
        width="xl"
        side="right"
        align="start"
        // The block is absolutely positioned and its `top`/`height` are rewritten inline during a
        // zoom, which fires no resize or scroll observer. Tracking every frame is what keeps the
        // panel attached while the canvas rescales under it.
        updatePositionStrategy="always"
        aria-labelledby={titleId}
        data-calendar-item-peek={item.id}
        // Focus enters the panel on open so a keyboard user reaches it, and does not bounce back
        // on close: the panel is portaled to the document body and has no trigger, so Radix has
        // nothing of its own to restore to. The selection state puts focus back on the block.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        onPointerDownOutside={onDismissOutside}
      >
        <PeekRail color={layer?.color ?? null} />
        <PopoverBody scroll="auto" className="flex flex-col gap-3">
          {body}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The layer-coloured band that ties the panel back to the block it came from.
 *
 * @remarks
 * The colour is a stored per-layer value rather than a token, so it arrives as an inline style;
 * a layer with no colour of its own falls through to the outline role and reads as a hairline.
 *
 * @param props - The layer's colour, when it has one.
 * @returns the rendered band.
 */
function PeekRail({ color }: { readonly color: string | null }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="h-1 w-full shrink-0"
      style={{ backgroundColor: color ?? 'var(--color-outline-variant)' }}
    />
  );
}
