'use client';

/**
 * `calendar/item-peek/use-calendar-item-selection` — the two-tier open state, owned once.
 *
 * @remarks
 * Clicking an event used to set an item id and throw a tall centered dialog over the calendar. It
 * now opens a peek anchored to the block, and the dialog becomes an explicit escalation. The
 * calendar page and the agenda rail both mount the event surfaces, so both hold this hook rather
 * than each keeping its own idea of what "open" means.
 *
 * `CalendarItemDrawer` still takes a plain `itemId`, which is why `detailItemId` exists: the drawer
 * knows nothing about tiers and its own tests keep passing untouched.
 */
import type { PopoverVirtualAnchorRef } from '@docket/ui/primitives';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  type CalendarItemAnchor,
  captureCalendarItemAnchor,
  resolveCalendarItemFocusTarget,
} from './calendar-item-anchor';

/** Which surface an event is currently open on. */
export type CalendarItemTier = 'peek' | 'detail';

/** One open calendar item, and how much of it is showing. */
export interface CalendarItemSelection {
  /** The open item. */
  readonly itemId: string;
  /** Whether the peek or the full detail is showing. */
  readonly tier: CalendarItemTier;
}

/** The two-tier open state and its transitions. */
export interface CalendarItemSelectionApi {
  /** What is open, if anything. */
  readonly selection: CalendarItemSelection | null;
  /** Feeds `<PopoverAnchor virtualRef>`; identity is stable across renders. */
  readonly anchorRef: PopoverVirtualAnchorRef;
  /** The item showing a peek, or `null`. */
  readonly peekItemId: string | null;
  /** The item showing the detail dialog, or `null`. Feeds `CalendarItemDrawer`. */
  readonly detailItemId: string | null;
  /** Open an item — as a peek when a control was activated, straight to detail when not. */
  readonly open: (itemId: string, anchor: HTMLElement | null) => void;
  /** Promote the open peek to the detail dialog. */
  readonly escalate: () => void;
  /** Close whatever is open and hand focus back to the block. */
  readonly close: () => void;
  /** Record that an outside press dismissed the peek. */
  readonly noteDismissal: () => void;
  /** Read and clear that record. True at most once per dismissal. */
  readonly consumeDismissal: () => boolean;
}

/**
 * Own the peek-then-detail progression for one calendar surface.
 *
 * @returns the selection state and its transitions.
 */
export function useCalendarItemSelection(): CalendarItemSelectionApi {
  const [selection, setSelection] = useState<CalendarItemSelection | null>(null);
  const anchorRef = useRef<CalendarItemAnchor['virtual']>(null);
  const capturedRef = useRef<CalendarItemAnchor | null>(null);
  const dismissedRef = useRef(false);

  const restoreFocus = useCallback((): void => {
    resolveCalendarItemFocusTarget(capturedRef.current)?.focus();
    capturedRef.current = null;
    anchorRef.current = null;
  }, []);

  const open = useCallback((itemId: string, anchor: HTMLElement | null): void => {
    const captured = captureCalendarItemAnchor(itemId, anchor);
    capturedRef.current = captured;
    anchorRef.current = captured.virtual;
    // Without a control to point at there is nothing for a peek to hang off, so the dense-overflow
    // list and any other synthesized request go straight to the detail dialog.
    setSelection({ itemId, tier: anchor ? 'peek' : 'detail' });
  }, []);

  const escalate = useCallback((): void => {
    setSelection((current) => (current ? { itemId: current.itemId, tier: 'detail' } : null));
  }, []);

  const close = useCallback((): void => {
    setSelection(null);
    restoreFocus();
  }, [restoreFocus]);

  const noteDismissal = useCallback((): void => {
    dismissedRef.current = true;
  }, []);

  const consumeDismissal = useCallback((): boolean => {
    const dismissed = dismissedRef.current;
    dismissedRef.current = false;
    return dismissed;
  }, []);

  return useMemo(
    () => ({
      selection,
      anchorRef,
      peekItemId: selection?.tier === 'peek' ? selection.itemId : null,
      detailItemId: selection?.tier === 'detail' ? selection.itemId : null,
      open,
      escalate,
      close,
      noteDismissal,
      consumeDismissal,
    }),
    [selection, open, escalate, close, noteDismissal, consumeDismissal],
  );
}

/**
 * Resolve the event a peek is about, from whatever collection the host surface already holds.
 *
 * @remarks
 * The calendar keys its items by id and the agenda scans its entries, but both need the same
 * "nothing open means nothing to look up" guard. Keeping it here means neither page carries the
 * branch, and the two cannot drift on what an absent selection means.
 *
 * @param itemId - The peeked item id, or `null` when no peek is open.
 * @param resolve - How this surface finds an item it is already rendering.
 * @returns the event, or `undefined` when nothing is open or the item has left the view.
 */
export function resolvePeekItem<T>(
  itemId: string | null,
  resolve: (id: string) => T | undefined,
): T | undefined {
  return itemId === null ? undefined : resolve(itemId);
}
