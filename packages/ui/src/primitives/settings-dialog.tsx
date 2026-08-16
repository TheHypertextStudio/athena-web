'use client';

/**
 * `@docket/ui` — large modal-shell primitive (the settings modal's panel).
 *
 * @remarks
 * A sibling of {@link DialogContent}, not a size variant of it. `DialogContent` is tuned for
 * small, single-purpose forms — it hardcodes `max-w-lg`, wraps its children in one
 * `overflow-y-auto` region, and centers a close button over free-flowing content. A large
 * multi-pane shell (header row, then an independently-scrolling nav rail beside an
 * independently-scrolling content pane) needs a different shape, not an override of that one, so
 * this defines its own `SettingsDialogContent` sharing only the unstyled Radix roots and the
 * scrim with {@link DialogPortal}/{@link DialogOverlay}/{@link DialogClose}/{@link DialogTitle}
 * (re-exported here, not duplicated).
 *
 * Deliberately layout-agnostic beyond size and chrome: `SettingsDialogContent` fixes the panel's
 * size, position, radius and elevation, but does not impose a nav-rail/content grid itself —
 * callers compose that from plain children, the same way {@link DialogHeader}/{@link DialogFooter}
 * are composed rather than baked into {@link DialogContent}. This keeps the primitive reusable for
 * any large multi-pane modal, not only this one.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { X } from '../icons';
import { cn } from '../lib/utils';
import { DialogClose, DialogOverlay, DialogPortal, DialogTitle } from './dialog';
import { focusRing } from './focus';

/**
 * The large, fixed-size modal panel (the visible settings-modal surface).
 *
 * @remarks
 * Renders its own {@link DialogPortal} + {@link DialogOverlay}, then a focus-trapped panel sized
 * `max-w-5xl` / `h-[85vh]` on wide viewports. Below the `sm` breakpoint it grows to fill the
 * viewport edge-to-edge instead — a settings surface this dense needs the full screen on a phone,
 * not a shrunken dialog — which a caller can also opt out of via `className`. The panel itself
 * imposes no internal layout: children render as-is, so the caller arranges its own header /
 * nav-rail / content regions. Shares {@link DialogContent}'s MD3 token surface
 * (`bg-surface-container-high`, `border-outline-variant`, `shadow-level3`) and modal layer
 * (`z-[110]`, above `Sheet`'s `z-[100]`).
 */
export function SettingsDialogContent({
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
  // Same opener-capture/restore dance as `DialogContent` — Docket's dialogs are controlled and
  // open from a plain button, so Radix's own `DialogTrigger`-only focus restore doesn't cover them.
  const openerRef = React.useRef<HTMLElement | null>(null);

  const handleOpenAutoFocus = React.useCallback(
    (event: Event): void => {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );

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
          // Full-bleed on narrow viewports (a settings surface this dense needs the whole
          // screen, not a shrunken dialog); a centered, fixed-size panel from `sm` up.
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98] shadow-level3 fixed inset-0 z-[110] flex flex-col overflow-hidden duration-(--dur-slow) ease-(--ease-out) outline-none sm:top-1/2 sm:left-1/2 sm:h-[85vh] sm:max-h-[48rem] sm:w-[calc(100%-2rem)] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border',
          className,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogClose
            aria-label="Close settings"
            className={cn(
              'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface absolute top-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-md opacity-70 transition-colors transition-opacity hover:opacity-100 disabled:pointer-events-none [&_svg]:size-5',
              // Matches the control scale's coarse floor: this is the one control on every
              // settings surface, and it sized itself outside that scale.
              'coarse:h-10 coarse:w-10',
              focusRing,
            )}
          >
            <X />
          </DialogClose>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export { DialogClose, DialogPortal, DialogOverlay, DialogTitle };
