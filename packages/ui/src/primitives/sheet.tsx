/**
 * `@docket/ui` — Sheet primitive (an edge-anchored off-canvas panel).
 *
 * @remarks
 * Hand-authored over `@radix-ui/react-dialog`, the same engine that powers the centered
 * {@link Dialog}. Radix supplies the hard parts for free — focus trap, `Escape`-to-close,
 * scroll-lock, return-focus-to-trigger, `role="dialog"` + `aria-modal`, and the
 * `aria-labelledby`/`aria-describedby` wiring between {@link SheetContent} and its
 * {@link SheetTitle}/{@link SheetDescription}. This module only changes the geometry: instead
 * of a centered modal, the panel is anchored to a window edge (default `left`) and slides in
 * from that edge — the layout shape Docket's mobile navigation drawer needs. All colors come
 * from the semantic MD3 tonal tokens in `@docket/ui/styles/globals.css`; open/close motion
 * reuses the `tw-animate-css` `data-[state=…]` conventions already used by the dialog.
 *
 * The unstyled passthrough roots ({@link Sheet}, {@link SheetTrigger}, {@link SheetPortal},
 * {@link SheetClose}) are re-exported verbatim; the visible surfaces are token-styled wrappers.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Sheet open={open} onOpenChange={setOpen}>
 *   <SheetContent side="left" aria-label="Navigation">
 *     <SheetTitle className="sr-only">Navigation</SheetTitle>
 *     <Sidebar … />
 *   </SheetContent>
 * </Sheet>
 * ```
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';

/**
 * Root controller for an open/closed sheet (Radix Dialog passthrough).
 *
 * @remarks
 * Use controlled (`open` + `onOpenChange`) so the host owns the open state — the shell's mobile
 * drawer is controlled so a nav selection can close it programmatically.
 */
export const Sheet = DialogPrimitive.Root;

/** Element that opens the sheet when activated (Radix passthrough). */
export const SheetTrigger = DialogPrimitive.Trigger;

/** Portal that renders the overlay + content into the document body (Radix passthrough). */
export const SheetPortal = DialogPrimitive.Portal;

/** Element that closes the sheet when activated; pair with `asChild` (Radix passthrough). */
export const SheetClose = DialogPrimitive.Close;

/**
 * The dimmed backdrop behind the sheet panel.
 *
 * @remarks
 * A semi-opaque scrim that fades in/out with the sheet; clicking it closes the sheet (Radix
 * dismiss). Rendered automatically by {@link SheetContent}.
 */
export function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.JSX.Element {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 duration-(--dur-slow) ease-(--ease-out)',
        className,
      )}
      {...props}
    />
  );
}

/** Which window edge the sheet is anchored to (and slides in from). */
export type SheetSide = 'left' | 'right';

/** The edge-anchored geometry + slide-in motion for each {@link SheetSide}. */
const SIDE_CLASS: Record<SheetSide, string> = {
  left: 'inset-y-0 left-0 h-full data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left border-r',
  right:
    'inset-y-0 right-0 h-full data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right border-l',
};

/**
 * The edge-anchored, focus-trapped sheet panel (the visible off-canvas surface).
 *
 * @remarks
 * Renders its own {@link SheetPortal} + {@link SheetOverlay}, then the focus-trapped panel
 * pinned to `side` (default `left`) and sliding in from that edge. The panel MUST contain a
 * {@link SheetTitle} (Radix requires a `DialogTitle` descendant for accessibility — use the
 * `sr-only` class when the title should not be visible). On open, Radix's `FocusScope` moves
 * focus into the panel; on close, focus returns to the opener (WAI-ARIA), and `Escape`/overlay
 * click dismiss it. The panel takes the MD3 `surface` tone so its content (the navigation)
 * reads as a solid sheet over the dimmed page.
 */
export function SheetContent({
  className,
  children,
  side = 'left',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Which window edge the panel anchors to (default `left`). */
  side?: SheetSide;
}): React.JSX.Element {
  // The element focused when the sheet opened — its opener — so focus can return to it on
  // close (WAI-ARIA). Radix's own restore only covers a `SheetTrigger`; the shell opens the
  // drawer from a standalone controlled button, so we capture and restore the opener ourselves.
  const openerRef = React.useRef<HTMLElement | null>(null);

  /** Capture the opener as `FocusScope` is about to move focus in (activeElement is still it). */
  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );

  /** Return focus to the opener on close (unless a caller already handled it). */
  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const opener = openerRef.current;
      openerRef.current = null;
      if (!event.defaultPrevented && opener?.isConnected) {
        event.preventDefault();
        opener.focus();
      }
    },
    [onCloseAutoFocus],
  );

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          'bg-surface text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex w-72 max-w-[85vw] flex-col shadow-lg ease-(--ease-out) outline-none data-[state=closed]:duration-(--dur-base) data-[state=open]:duration-(--dur-slow)',
          focusRing,
          SIDE_CLASS[side],
          className,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

/**
 * The sheet's accessible title.
 *
 * @remarks
 * Radix wires this element's id into the panel's `aria-labelledby`, so every sheet MUST render
 * exactly one `SheetTitle` (apply `className="sr-only"` when it should be visually hidden).
 */
export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn('text-on-surface text-base font-semibold', className)}
      {...props}
    />
  );
}

/**
 * The sheet's accessible description.
 *
 * @remarks
 * Radix wires this element's id into the panel's `aria-describedby`. Optional; apply
 * `className="sr-only"` when it should be visually hidden.
 */
export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      className={cn('text-on-surface-variant text-body', className)}
      {...props}
    />
  );
}
