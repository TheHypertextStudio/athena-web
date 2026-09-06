'use client';

/**
 * `calendar/item-peek/calendar-item-anchor` — where an event peek points, and where focus goes back.
 *
 * @remarks
 * The peek is anchored to the control a person activated, captured at click time, rather than
 * looked up afterwards. Two reasons. A multi-day all-day item renders one pill per lane it spans
 * (`scheduling-all-day-lane.tsx`), so `[data-schedule-item-body="{id}"]` matches several elements
 * and a query cannot tell which one was pressed. And the block is the `<button>` inside the card,
 * not the card itself: the `<article>` reaches 12px past the visible block on both edges to host
 * invisible resize targets, so anchoring there would float the peek off the event.
 *
 * The captured node is handed to Radix as-is rather than wrapped in a `getBoundingClientRect`
 * closure. Radix passes it straight to floating-ui, which attaches its ancestor-scroll and resize
 * observers only when the reference is a real element — that is what makes the peek follow the
 * canvas as it scrolls instead of stranding itself mid-air.
 */
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';

/** A captured click target, plus the geometry the peek positions from. */
export interface CalendarItemAnchor {
  /** The calendar item the peek is about. */
  readonly itemId: string;
  /** The element Radix positions against; `null` when the request carried no control. */
  readonly virtual: PopoverVirtualAnchor | null;
  /** The control to hand focus back to on close. */
  readonly element: HTMLElement | null;
}

/**
 * Capture the control that opened a peek.
 *
 * @param itemId - The calendar item being opened.
 * @param element - The activated control, or `null` when the request was synthesized.
 * @returns the anchor record to store alongside the selection.
 */
export function captureCalendarItemAnchor(
  itemId: string,
  element: HTMLElement | null,
): CalendarItemAnchor {
  return { itemId, virtual: element, element };
}

/**
 * Find where focus should land when a peek closes.
 *
 * @remarks
 * The captured node wins while it is still in the document. A re-render — a background refetch, a
 * lane relayout — replaces it, so the fallbacks re-find the same control by the attributes the
 * scheduling canvas and the agenda row both publish. Radix has nothing of its own to restore to
 * here, because the peek has an anchor and no trigger.
 *
 * @param anchor - The anchor captured when the peek opened, if any.
 * @returns the element to focus, or `null` when the control is gone from the page.
 */
export function resolveCalendarItemFocusTarget(
  anchor: CalendarItemAnchor | null,
): HTMLElement | null {
  if (!anchor) return null;
  if (anchor.element?.isConnected === true) return anchor.element;
  if (typeof document === 'undefined') return null;
  const escaped = CSS.escape(anchor.itemId);
  return document.querySelector<HTMLElement>(
    `[data-schedule-item-body="${escaped}"], [data-calendar-item-anchor="${escaped}"]`,
  );
}
