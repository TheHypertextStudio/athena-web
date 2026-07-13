/**
 * `@docket/ui` — Dialog primitive family (focused, Linear-style modal).
 *
 * @remarks
 * Hand-authored over `@radix-ui/react-dialog`, the same way {@link DropdownMenu} wraps
 * `@radix-ui/react-dropdown-menu`. Radix supplies the hard parts for free — focus trap,
 * `Escape`-to-close, scroll-lock, return-focus-to-trigger, `role="dialog"` + `aria-modal`,
 * and the `aria-labelledby`/`aria-describedby` wiring between {@link DialogContent} and its
 * {@link DialogTitle}/{@link DialogDescription}. This module only adds the Docket look: an
 * MD3 tonal surface panel (`bg-surface-container-high`, `border-outline-variant`,
 * `rounded-xl`, `shadow-lg`), a dimmed {@link DialogOverlay} scrim, and a built-in close
 * affordance. All colors come from the semantic design tokens in
 * `@docket/ui/styles/globals.css`; open/close motion reuses the `tw-animate-css`
 * `data-[state=…]` conventions already used by the dropdown menu.
 *
 * The unstyled passthrough roots ({@link Dialog}, {@link DialogTrigger},
 * {@link DialogPortal}, {@link DialogClose}) are re-exported verbatim; the visible surfaces
 * are token-styled wrappers.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Dialog open={open} onOpenChange={setOpen}>
 *   <DialogContent>
 *     <DialogHeader>
 *       <DialogTitle>New project</DialogTitle>
 *       <DialogDescription>Give it a name to get started.</DialogDescription>
 *     </DialogHeader>
 *     <Input autoFocus placeholder="Project name" />
 *     <DialogFooter>
 *       <DialogClose asChild>
 *         <Button variant="ghost">Cancel</Button>
 *       </DialogClose>
 *       <Button>Create</Button>
 *     </DialogFooter>
 *   </DialogContent>
 * </Dialog>
 * ```
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { X } from '../icons';

import { cn } from '../lib/utils';
import { focusRing } from './focus';

/**
 * Root controller for an open/closed dialog (Radix passthrough).
 *
 * @remarks
 * Use controlled (`open` + `onOpenChange`) for the Linear create flows so the host page owns
 * the open state; uncontrolled (`defaultOpen`) also works for simple cases.
 */
export const Dialog = DialogPrimitive.Root;

/** Element that opens the dialog when activated (Radix passthrough). */
export const DialogTrigger = DialogPrimitive.Trigger;

/** Portal that renders the overlay + content into the document body (Radix passthrough). */
export const DialogPortal = DialogPrimitive.Portal;

/** Element that closes the dialog when activated; pair with `asChild` (Radix passthrough). */
export const DialogClose = DialogPrimitive.Close;

/**
 * The dimmed backdrop behind the dialog panel.
 *
 * @remarks
 * A semi-opaque scrim that fades in/out with the dialog. Rendered automatically by
 * {@link DialogContent}; exported for callers that compose their own portal layout. Dialogs use
 * the `z-[110]` modal layer so confirmations opened from a `z-[100]` {@link Sheet} remain
 * visible and interactive.
 */
export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.JSX.Element {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[110] bg-black/40 duration-(--dur-slow) ease-(--ease-out)',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The centered, rounded dialog panel (the visible modal surface).
 *
 * @remarks
 * Renders its own {@link DialogPortal} + {@link DialogOverlay}, then the focus-trapped panel
 * centered in the viewport. The panel is labelled by its {@link DialogTitle} (Radix requires a
 * `DialogTitle` descendant for accessibility). A built-in close button (top-right, MUI `X`
 * glyph) is included unless `showClose` is `false`. The panel caps at `max-h-[85vh]` and
 * scrolls its body when content overflows. The panel shares the overlay's `z-[110]` modal layer,
 * above sheets at `z-[100]`.
 *
 * Focus management: on open, Radix's `FocusScope` moves focus to the first focusable descendant
 * (so the primary field lands focused without a React `autoFocus` attribute — a DOM `autoFocus`
 * short-circuits `FocusScope` and suppresses its open-focus event, so callers order the primary
 * field first in the children and must NOT put `autoFocus` on it). On close, focus is returned
 * to the element that opened the dialog (WAI-ARIA). Radix's own restore only targets a
 * {@link DialogTrigger}; Docket's create flows are *controlled* and open from a plain button, so
 * this component additionally records whatever element was focused when the open-focus event
 * fired (the opener) and refocuses it on close — unless a caller-supplied `onCloseAutoFocus`
 * already handled it by calling `preventDefault`.
 */
export function DialogContent({
  className,
  children,
  showClose = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Render the built-in top-right close button (default `true`). */
  showClose?: boolean;
}): React.JSX.Element {
  // The element focused when the panel opened — the dialog's opener — so focus can return to it
  // on close even when there is no Radix `DialogTrigger` to restore it for us.
  const openerRef = React.useRef<HTMLElement | null>(null);

  /**
   * Capture the opener at the moment `FocusScope` is about to move focus into the panel: at this
   * point `document.activeElement` is still the element that triggered the open.
   */
  const handleOpenAutoFocus = React.useCallback(
    (event: Event): void => {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );

  /** Return focus to the opener on close (Radix's own restore only covers `DialogTrigger`). */
  const handleCloseAutoFocus = React.useCallback(
    (event: Event): void => {
      onCloseAutoFocus?.(event);
      const opener = openerRef.current;
      openerRef.current = null;
      if (event.defaultPrevented) return;
      if (opener?.isConnected) {
        event.preventDefault();
        opener.focus();
      }
    },
    [onCloseAutoFocus],
  );

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          // `w-[calc(100%-2rem)]` keeps a 1rem gutter on each side at small viewports so the
          // panel never bleeds to the window edge; `max-w-lg` caps it once the screen is wide
          // enough that the calc would exceed it (the narrower per-dialog `max-w-md` still wins).
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98] fixed top-1/2 left-1/2 z-[110] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border p-6 shadow-lg duration-(--dur-slow) ease-(--ease-out) outline-none',
          className,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-md opacity-70 transition-colors transition-opacity hover:opacity-100 disabled:pointer-events-none [&_svg]:size-4',
              focusRing,
            )}
          >
            <X />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * Heading block at the top of the dialog (title + optional description).
 *
 * @remarks
 * A plain layout wrapper; it adds vertical stacking and a small gap. Place a
 * {@link DialogTitle} (required) and optionally a {@link DialogDescription} inside it.
 */
export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />;
}

/**
 * Actions row at the bottom of the dialog (primary + Cancel).
 *
 * @remarks
 * Right-aligns its children on wide viewports and stacks them (reversed, primary last) on
 * narrow ones, matching the shadcn dialog footer convention.
 */
export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

/**
 * The dialog's accessible title.
 *
 * @remarks
 * Radix wires this element's id into the panel's `aria-labelledby`, so every dialog MUST
 * render exactly one `DialogTitle` (otherwise screen readers announce an unlabelled dialog).
 */
export function DialogTitle({
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
 * The dialog's accessible description.
 *
 * @remarks
 * Radix wires this element's id into the panel's `aria-describedby`. Optional, but recommended
 * to explain what the dialog does.
 */
export function DialogDescription({
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
