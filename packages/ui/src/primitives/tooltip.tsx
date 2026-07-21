/**
 * `@docket/ui` — Tooltip primitive family (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-tooltip`. A tooltip is the lightest of Docket's pop-up surfaces: a small,
 * non-interactive label that appears on hover/focus to name an icon-only control or expand a
 * truncated value — the inline responsiveness the Phase A review asked for. It is NOT for rich
 * or interactive content (use {@link HoverCard} for a preview card, or {@link DropdownMenu} /
 * {@link ContextMenu} for actions).
 *
 * Radix supplies the behaviour for free: hover/focus open with a shared open delay, pointer-leave
 * close, `Escape` dismiss, collision-aware positioning, and `role="tooltip"` wired to the trigger
 * via `aria-describedby`. This module only adds the Docket look — the same MD3 tonal surface,
 * `border-outline-variant` hairline, `rounded-lg`, and `tw-animate-css` `data-[state=…]` motion
 * the {@link PopoverContent}/{@link DropdownMenuContent} surfaces use — plus a darker, denser
 * scale appropriate to a transient label (smaller `text-xs`, tighter padding, `shadow-md`).
 *
 * The unstyled passthrough roots ({@link TooltipProvider}, {@link Tooltip},
 * {@link TooltipTrigger}) are re-exported verbatim; {@link TooltipContent} is the token-styled
 * surface. Wrap the app (or a subtree) in a single {@link TooltipProvider} so every tooltip
 * shares one open-delay/skip-delay timing.
 *
 * @example
 * ```tsx
 * <TooltipProvider>
 *   <Tooltip>
 *     <TooltipTrigger asChild>
 *       <Button variant="ghost" size="icon" aria-label="Filter"><Filter /></Button>
 *     </TooltipTrigger>
 *     <TooltipContent>Filter</TooltipContent>
 *   </Tooltip>
 * </TooltipProvider>
 * ```
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Shared timing context for the tooltips beneath it (Radix passthrough).
 *
 * @remarks
 * Owns the open `delayDuration` and the `skipDelayDuration` window during which moving between
 * tooltips opens them instantly. Mount one near the app root (or per subtree) so all tooltips
 * feel consistent.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

/** Root controller for a single open/closed tooltip (Radix passthrough). */
export const Tooltip = TooltipPrimitive.Root;

/** Element the tooltip describes; pass `asChild` to wrap a real control (Radix passthrough). */
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * The floating tooltip label; rendered through a portal.
 *
 * @remarks
 * A compact, non-interactive surface that opens beside the trigger. Defaults to `sideOffset={4}`
 * to match the other floating surfaces. Keep its content to a short phrase — for anything richer
 * or interactive, reach for {@link HoverCard}.
 */
export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'bg-surface-container-highest text-on-surface border-outline-variant data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[120] w-fit max-w-xs origin-[var(--radix-tooltip-content-transform-origin)] rounded-lg border px-2.5 py-1.5 text-xs shadow-md',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
