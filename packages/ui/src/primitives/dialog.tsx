'use client';

/*
 * Marked a client module because {@link DialogContent} restores focus to its opener with `React.useRef`
 * and `React.useCallback` — hooks, and DOM-only ones at that. Radix's own interactive packages
 * ship this directive, but that boundary does not extend to the focus handling written here.
 *
 * Nothing currently renders this from a Server Component, so this is a guard rather than a fix:
 * without it, the first server-rendered dialog would fail at the `useRef` call. The stateless
 * primitives beside it (button, card, badge, input, separator) genuinely do not need the
 * directive and deliberately do not carry it, so they stay usable from Server Components.
 */

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
 * `rounded-xl`, `shadow-level3`), a dimmed {@link DialogOverlay} scrim, and a built-in close
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
import type {
  DialogHeight,
  DialogPresentation,
  DialogSize,
  OverlayInset,
} from './overlay-contract';
import { useOverlayFocusRestore } from './use-overlay-focus-restore';

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
      data-overlay-scrim=""
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 bg-scrim/40 fixed inset-0 z-[110] duration-(--dur-slow) ease-(--ease-out)',
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
const DIALOG_SIZE: Readonly<Record<DialogSize, string>> = {
  compact: 'max-w-sm',
  standard: 'max-w-lg',
  large: 'max-w-2xl',
  wide: 'max-w-4xl',
  detail: 'max-w-5xl',
  workspace: 'max-w-6xl',
};

const DIALOG_HEIGHT: Readonly<Record<DialogHeight, string>> = {
  content: 'max-h-[min(85dvh,48rem)]',
  medium: 'h-[min(60dvh,36rem)]',
  tall: 'h-[min(80dvh,48rem)]',
  viewport: 'h-[calc(100dvh-1.5rem)]',
};

function dialogPresentationClass(presentation: DialogPresentation): string {
  const size = DIALOG_SIZE[presentation.size ?? 'standard'];
  const height = DIALOG_HEIGHT[presentation.height ?? 'content'];
  if (presentation.kind === 'fullscreen')
    return 'inset-0 h-[100dvh] w-[100vw] rounded-none border-0';
  if (presentation.kind === 'bottom-sheet')
    return `inset-x-0 bottom-0 ${height} w-full rounded-t-xl border-x-0 border-b-0`;
  if (presentation.kind === 'responsive-fullscreen')
    return `inset-0 h-[100dvh] w-[100vw] rounded-none border-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border ${size} ${height}`;
  if (presentation.kind === 'top')
    return `top-3 left-1/2 w-[calc(100%-1.5rem)] -translate-x-1/2 ${size} ${height}`;
  if (presentation.kind === 'hosted') return `${size} ${height}`;
  return `top-1/2 left-1/2 w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 ${size} ${height}`;
}

/** Props for {@link DialogContent}. */
export interface DialogContentProps extends Omit<
  React.ComponentProps<typeof DialogPrimitive.Content>,
  'asChild' | 'style'
> {
  /** The shared presentation that owns panel position, size, and viewport inset. */
  readonly presentation?: DialogPresentation | undefined;
  /** Render the built-in top-right close button (default `true`). */
  readonly showClose?: boolean | undefined;
  /** Label for the built-in close control. */
  readonly closeLabel?: string | undefined;
  /** Add a container query to a multi-column dialog body. */
  readonly containerQuery?: boolean | undefined;
  /** Compatibility escape hatch while existing dialogs migrate to presentation slots. */
  readonly className?: string | undefined;
}

function hostedDialogInteractivityClass(
  hosted: Extract<DialogPresentation, { kind: 'hosted' }> | null,
): string | undefined {
  return hosted ? 'pointer-events-auto' : undefined;
}

/** Render a focus-trapped dialog panel with one shared presentation contract. */
export function DialogContent({
  className,
  children,
  showClose = true,
  closeLabel = 'Close',
  presentation,
  containerQuery = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps): React.JSX.Element {
  const focusRestore = useOverlayFocusRestore(onOpenAutoFocus, onCloseAutoFocus);
  const hosted = presentation?.kind === 'hosted' ? presentation : null;
  const presentationClass = presentation ? dialogPresentationClass(presentation) : null;

  return (
    <DialogPortal container={hosted?.portalContainer}>
      {hosted?.backdrop === 'none' ? null : (
        <DialogOverlay className={hosted?.backdrop === 'surface' ? 'bg-surface' : undefined} />
      )}
      <DialogPrimitive.Content
        {...(hosted
          ? {
              style: {
                top: hosted.position.top,
                left: hosted.position.left,
                width: hosted.position.width,
                maxHeight: hosted.position.maxHeight,
              },
            }
          : {})}
        className={cn(
          // `w-[calc(100%-2rem)]` keeps a 1rem gutter on each side at small viewports so the
          // panel never bleeds to the window edge; `max-w-lg` caps it once the screen is wide
          // enough that the calc would exceed it (the narrower per-dialog `max-w-md` still wins).
          'bg-surface-container-high text-on-surface data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98] shadow-level3 border-outline-variant fixed z-[110] flex min-h-0 flex-col gap-0 overflow-hidden overscroll-contain rounded-xl border p-0 duration-(--dur-slow) ease-(--ease-out) outline-none',
          hostedDialogInteractivityClass(hosted),
          presentationClass ??
            'top-1/2 left-1/2 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 p-6',
          { '@container': containerQuery },
          className,
        )}
        data-surface-tone="floating"
        onOpenAutoFocus={focusRestore.onOpenAutoFocus}
        onCloseAutoFocus={focusRestore.onCloseAutoFocus}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={cn(
              'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-md opacity-70 transition-colors transition-opacity hover:opacity-100 disabled:pointer-events-none [&_svg]:size-6',
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
  inset = 'standard',
  ...props
}: React.ComponentProps<'div'> & { readonly inset?: OverlayInset | undefined }): React.JSX.Element {
  return (
    <div
      className={cn(
        // DialogContent's shared close control sits at the top-right edge. Reserve that column
        // here so titles never rely on a caller-specific right-padding repair.
        'flex shrink-0 flex-col gap-1.5 pr-12 text-left',
        overlayInsetClass(inset),
        className,
      )}
      {...props}
    />
  );
}

/** The only Dialog region permitted to own overflow. */
export function DialogBody({
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

/**
 * Actions row at the bottom of the dialog (primary + Cancel).
 *
 * @remarks
 * Right-aligns its children on wide viewports and stacks them (reversed, primary last) on
 * narrow ones, matching the shadcn dialog footer convention.
 */
export function DialogFooter({
  className,
  inset = 'standard',
  ...props
}: React.ComponentProps<'div'> & { readonly inset?: OverlayInset | undefined }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        overlayInsetClass(inset),
        className,
      )}
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
      className={cn('text-on-surface text-title-medium', className)}
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
      className={cn('text-on-surface-variant text-body-medium', className)}
      {...props}
    />
  );
}
