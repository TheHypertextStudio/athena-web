'use client';

/*
 * Marked a client module because {@link SheetContent} restores focus to its opener with `React.useRef`
 * and `React.useCallback` — hooks, and DOM-only ones at that. Radix's own interactive packages
 * ship this directive, but that boundary does not extend to the focus handling written here.
 *
 * Nothing currently renders this from a Server Component, so this is a guard rather than a fix:
 * without it, the first server-rendered dialog would fail at the `useRef` call. The stateless
 * primitives beside it (button, card, badge, input, separator) genuinely do not need the
 * directive and deliberately do not carry it, so they stay usable from Server Components.
 */

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
import type { OverlayInset, SheetPresentation, SheetSize } from './overlay-contract';
import { useOverlayFocusRestore } from './use-overlay-focus-restore';

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
      data-overlay-scrim=""
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 bg-scrim/40 fixed inset-0 z-[100] duration-(--dur-slow) ease-(--ease-out)',
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

const SHEET_SIZE: Readonly<Record<SheetSize, string>> = {
  navigation: 'w-72 max-w-[85vw]',
  standard: 'w-96 max-w-[calc(100vw-1.5rem)]',
  wide: 'w-[28rem] max-w-[calc(100vw-1.5rem)]',
};

/**
 * The `sm`-and-up edge anchor and inner border for each {@link SheetSide}.
 *
 * Spelled out per side because Tailwind reads class names out of the source text: a name built
 * by interpolation is never a complete string here, so no rule is generated for it and the
 * attribute in the DOM matches nothing. Anchoring built that way left the panel on `inset-0`
 * from the full-screen layout, stretching it across the viewport instead of pinning it to its
 * edge — and it looked correct in both the markup and any test that reads the class list.
 */
const SIDE_ANCHOR_SM: Readonly<Record<SheetSide, string>> = {
  left: 'sm:right-auto sm:left-0 sm:border-r',
  right: 'sm:left-auto sm:right-0 sm:border-l',
};

function sheetPresentationClass(
  presentation: SheetPresentation,
  side: SheetSide,
  size: SheetSize,
): string {
  if (presentation === 'fullscreen') return 'inset-0 h-[100dvh] w-[100vw] border-0';
  if (presentation === 'responsive-fullscreen')
    return `inset-0 h-[100dvh] w-[100vw] border-0 sm:inset-y-0 sm:h-full sm:w-auto sm:border-0 ${SIDE_ANCHOR_SM[side]} ${SHEET_SIZE[size]}`;
  return `${SIDE_CLASS[side]} ${SHEET_SIZE[size]}`;
}

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
  presentation = 'edge',
  size = 'navigation',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Which window edge the panel anchors to (default `left`). */
  side?: SheetSide;
  /** The shared sheet presentation that owns viewport geometry. */
  presentation?: SheetPresentation | undefined;
  /** The width tier used by an edge presentation. */
  size?: SheetSize | undefined;
}): React.JSX.Element {
  const focusRestore = useOverlayFocusRestore(onOpenAutoFocus, onCloseAutoFocus);

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out shadow-level1 fixed z-[100] flex min-h-0 flex-col gap-0 overflow-hidden overscroll-contain p-0 ease-(--ease-out) outline-none data-[state=closed]:duration-(--dur-base) data-[state=open]:duration-(--dur-slow)',
          focusRing,
          sheetPresentationClass(presentation, side, size),
          className,
        )}
        data-surface-tone="floating"
        onOpenAutoFocus={focusRestore.onOpenAutoFocus}
        onCloseAutoFocus={focusRestore.onCloseAutoFocus}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

/** Fixed header region that shares the sheet body's horizontal inset. */
export function SheetHeader({
  className,
  inset = 'standard',
  ...props
}: React.ComponentProps<'div'> & { readonly inset?: OverlayInset | undefined }): React.JSX.Element {
  return (
    <div
      className={cn('flex shrink-0 flex-col gap-1.5', overlayInsetClass(inset), className)}
      {...props}
    />
  );
}

/** The only Sheet region permitted to own vertical overflow. */
export function SheetBody({
  className,
  inset = 'standard',
  scroll = 'auto',
  ...props
}: React.ComponentProps<'div'> & {
  readonly inset?: OverlayInset | undefined;
  readonly scroll?: 'auto' | 'visible' | undefined;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-0 flex-1',
        overlayInsetClass(inset),
        scroll === 'auto' && 'overflow-y-auto overscroll-contain',
        className,
      )}
      {...(scroll === 'auto' ? { 'data-overlay-scroll-owner': '' } : {})}
      {...props}
    />
  );
}

/** Fixed action region that shares the sheet body's horizontal inset. */
export function SheetFooter({
  className,
  inset = 'standard',
  ...props
}: React.ComponentProps<'div'> & { readonly inset?: OverlayInset | undefined }): React.JSX.Element {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-2', overlayInsetClass(inset), className)}
      {...props}
    />
  );
}

function overlayInsetClass(inset: OverlayInset): string {
  if (inset === 'none') return '';
  if (inset === 'compact') return 'px-4 py-3';
  return 'px-6 py-4';
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
      className={cn('text-on-surface text-title-small', className)}
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
      className={cn('text-on-surface-variant text-body-medium', className)}
      {...props}
    />
  );
}
