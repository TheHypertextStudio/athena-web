'use client';

/**
 * `calendar/calendar-item-card` — the layer-aware presentation for one layered-calendar item.
 *
 * @remarks
 * The full calendar view's and (via the agenda's `calendar_item` seam) the agenda rail's shared
 * item primitive: one component renders every {@link CalendarItemOut.kind} — `provider_event`,
 * `native_block`, `task_timebox`, `availability_block` — through a single set of visuals (a layer
 * color strip, a kind icon, a compact sync/conflict badge) rather than a one-off branch per kind
 * scattered across calendar surfaces (`docs/engineering/specs/calendar-ui.md` acceptance
 * criteria). Drag/resize affordances render only when `item.permissions.canEditCore` — never a
 * dead-looking handle for a read-only item — and read-only items instead surface their reason via
 * an accessible badge, so they stay useful and linkable without a false promise of editability.
 *
 * Purely presentational: it never calls a mutation itself. `onOpen` opens the item workspace
 * drawer; `onDragHandlePointerDown`/`onResizeHandlePointerDown` (only invoked when supplied AND
 * the item is editable) hand the pointer gesture to the caller, which owns the timeline's pixel
 * geometry and the actual `useUpdateCalendarItem` call.
 */
import type {
  CalendarItemKind,
  CalendarItemOut,
  CalendarItemPermission,
  CalendarItemSyncState,
  CalendarLayerOut,
} from '@docket/types';
import {
  Calendar,
  Layers,
  type LucideIcon,
  MoreHorizontal,
  RefreshCw,
  Schedule,
  Shield,
  TaskAlt,
  XCircle,
} from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type PointerEvent as ReactPointerEvent } from 'react';

/** How the card lays out: a compact list `row`, or a fill-height timeline `block`. */
export type CalendarItemCardLayout = 'row' | 'block';

/** Stable `view-transition-name` for a calendar item — shared by the card, drawer, and timeline box. */
export function calendarItemTransitionName(itemId: string): string {
  return `calendar-item-${itemId}`;
}

/** The icon glyph for each layered-calendar item kind. Reused by the item workspace drawer. */
export const CALENDAR_ITEM_KIND_ICON: Record<CalendarItemKind, LucideIcon> = {
  provider_event: Calendar,
  native_event: Calendar,
  native_block: Layers,
  timebox: Layers,
  task_timebox: TaskAlt,
  availability_block: Schedule,
};

/** The compact kind label shown in the card's metadata line. Reused by the item workspace drawer. */
export const CALENDAR_ITEM_KIND_LABEL: Record<CalendarItemKind, string> = {
  provider_event: 'Provider event',
  native_event: 'Event',
  native_block: 'Block',
  timebox: 'Timebox',
  task_timebox: 'Timebox',
  availability_block: 'Availability',
};

/** Human labels for {@link CalendarItemPermission.readOnlyReason}. Reused by the item workspace drawer. */
export const READ_ONLY_REASON_LABEL: Record<
  NonNullable<CalendarItemPermission['readOnlyReason']>,
  string
> = {
  provider_scope: 'Read-only — no calendar write access granted',
  layer_access_role: 'Read-only — your role on this layer cannot edit',
  event_capability: 'Read-only — the provider marked this event un-editable',
  recurrence_unsupported: 'Read-only — recurring event editing is not yet supported',
  conflict: 'Read-only until the sync conflict is resolved',
  kind: 'Read-only',
};

/** A sync-state badge's icon + label. */
export interface SyncStateMeta {
  /** The badge icon. */
  icon: LucideIcon;
  /** The badge label. */
  label: string;
}

/**
 * Icon + label for a non-`clean` sync state (`null` for `clean`, which shows no badge). Reused by
 * the item workspace drawer's sync status section.
 */
export const SYNC_STATE_META: Record<CalendarItemSyncState, SyncStateMeta | null> = {
  clean: null,
  local_dirty: { icon: RefreshCw, label: 'Unsaved changes' },
  push_pending: { icon: RefreshCw, label: 'Syncing…' },
  conflict: { icon: XCircle, label: 'Conflict' },
  provider_error: { icon: XCircle, label: 'Sync failed' },
};

const KIND_ICON = CALENDAR_ITEM_KIND_ICON;
const KIND_LABEL = CALENDAR_ITEM_KIND_LABEL;

/** Local clock label, e.g. `9:30 AM`. */
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The card's time label: a clock range in `block` layout, a single start clock in `row`. */
function timeLabel(item: CalendarItemOut, block: boolean): string {
  if (item.startsAt && item.endsAt) {
    return block
      ? `${formatClock(item.startsAt)} – ${formatClock(item.endsAt)}`
      : formatClock(item.startsAt);
  }
  return block ? 'All day' : '—';
}

/** Props for {@link CalendarItemCard}. */
export interface CalendarItemCardProps {
  /** The calendar item to render. */
  item: CalendarItemOut;
  /** The item's owning layer, for its color/title; omitted renders a neutral strip. */
  layer?: CalendarLayerOut;
  /** How the card lays out (default `row`). */
  layout?: CalendarItemCardLayout;
  /** Open the item workspace drawer for this item. */
  onOpen: (itemId: string) => void;
  /**
   * Start a drag-to-move gesture from the card's move handle. Only rendered (and only invoked)
   * when `item.permissions.canEditCore` is true; omit to render no move handle even when
   * editable (e.g. the agenda rail, which has no drag surface to move within).
   */
  onDragHandlePointerDown?: (itemId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  /**
   * Start a resize-to-extend gesture from the card's bottom-edge resize handle. Only rendered (and
   * only invoked) when `item.permissions.canEditCore` is true and `layout` is `block`.
   */
  onResizeHandlePointerDown?: (itemId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** The shared layered-calendar item card, reshaped by `layout`, gated by the item's permissions. */
export default function CalendarItemCard({
  item,
  layer,
  layout = 'row',
  onOpen,
  onDragHandlePointerDown,
  onResizeHandlePointerDown,
}: CalendarItemCardProps): JSX.Element {
  const block = layout === 'block';
  const Icon = KIND_ICON[item.kind];
  const canEdit = item.permissions.canEditCore;
  const time = timeLabel(item, block);
  const color = layer?.color ?? null;
  const syncMeta = item.hasConflict ? SYNC_STATE_META.conflict : SYNC_STATE_META[item.syncState];
  const readOnlyLabel = item.permissions.readOnlyReason
    ? READ_ONLY_REASON_LABEL[item.permissions.readOnlyReason]
    : null;

  const metaLine = [KIND_LABEL[item.kind], layer?.title].filter(Boolean).join(' · ');

  return (
    <div
      style={{ viewTransitionName: calendarItemTransitionName(item.id) }}
      className={cn(
        'border-outline-variant bg-surface-container-low hover:bg-surface-container relative flex h-full w-full items-start gap-2 overflow-hidden rounded-lg border pr-2 pl-3 transition-[opacity,background-color]',
        block ? 'py-2' : 'py-1.5',
        item.hasConflict && 'border-destructive',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color ?? 'var(--color-outline-variant)' }}
      />
      <button
        type="button"
        onClick={() => {
          onOpen(item.id);
        }}
        className={cn(
          'focus-visible:ring-ring flex min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none',
          block ? 'flex-col gap-0.5' : 'flex-row items-start gap-2',
        )}
      >
        <Icon
          aria-hidden="true"
          className="text-on-surface-variant mt-0.5 shrink-0 [&_svg]:size-4"
          style={{ color: color ?? undefined }}
        />
        {block ? (
          <>
            <span className="text-on-surface truncate text-sm font-medium">{item.title}</span>
            <span className="text-on-surface-variant truncate text-xs tabular-nums">{time}</span>
            <span className="text-on-surface-variant mt-auto truncate text-xs">{metaLine}</span>
          </>
        ) : (
          <>
            <span className="text-on-surface-variant w-14 shrink-0 pt-0.5 text-xs tabular-nums">
              {time}
            </span>
            <span className="text-on-surface flex-1 truncate text-sm font-medium">
              {item.title}
            </span>
            <span className="text-on-surface-variant max-w-28 truncate text-xs">{metaLine}</span>
          </>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {readOnlyLabel ? (
          <span
            role="img"
            aria-label={readOnlyLabel}
            title={readOnlyLabel}
            className="text-on-surface-variant [&_svg]:size-3.5"
          >
            <Shield />
          </span>
        ) : null}
        {syncMeta ? (
          <span
            role="img"
            aria-label={syncMeta.label}
            title={syncMeta.label}
            className={cn(
              'flex items-center gap-1 text-xs',
              item.hasConflict || item.syncState === 'provider_error'
                ? 'text-destructive'
                : 'text-on-surface-variant',
            )}
          >
            <syncMeta.icon
              className={cn(
                '[&_svg]:size-3.5',
                item.syncState === 'push_pending' && 'animate-spin',
              )}
            />
          </span>
        ) : null}
        {canEdit && onDragHandlePointerDown ? (
          <button
            type="button"
            aria-label="Move"
            title="Drag to move"
            onPointerDown={(event) => {
              onDragHandlePointerDown(item.id, event);
            }}
            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring cursor-grab touch-none rounded-sm focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-4"
          >
            <MoreHorizontal />
          </button>
        ) : null}
      </div>

      {canEdit && block && onResizeHandlePointerDown ? (
        <button
          type="button"
          aria-label="Resize"
          title="Drag to resize"
          onPointerDown={(event) => {
            onResizeHandlePointerDown(item.id, event);
          }}
          className="hover:bg-primary/40 absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none"
        />
      ) : null}
    </div>
  );
}
