/**
 * `@docket/ui` — HoverCard primitive family (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-hover-card`. A hover card is the richer sibling of the {@link Tooltip}: a
 * floating *card* of preview content (an entity summary, an assignee's details, a linked issue's
 * status) that opens on hover/focus after a short delay. Unlike a tooltip it may contain layout
 * and read-only structure — but it is still a peek, not a place for actions (use
 * {@link DropdownMenu} / {@link ContextMenu} for those).
 *
 * Radix supplies the behaviour for free: hover/focus open + leave close with `openDelay`/
 * `closeDelay`, collision-aware positioning, and the pointer-bridge that lets the cursor travel
 * from trigger to card without dismissing it. This module only adds the Docket look — the MD3
 * tonal `surface` panel, `border-outline-variant` hairline, `rounded-lg`, `shadow-md`, and the
 * `tw-animate-css` `data-[state=…]` motion shared with {@link PopoverContent}.
 *
 * The unstyled passthrough roots ({@link HoverCard}, {@link HoverCardTrigger}) are re-exported
 * verbatim; {@link HoverCardContent} is the token-styled surface.
 *
 * @example
 * ```tsx
 * <HoverCard>
 *   <HoverCardTrigger asChild>
 *     <a href="/issues/DKT-12">DKT-12</a>
 *   </HoverCardTrigger>
 *   <HoverCardContent>
 *     <p className="text-body-medium font-medium">Fix timezone drift</p>
 *     <p className="text-on-surface-variant text-body-medium">In Progress · Due Fri</p>
 *   </HoverCardContent>
 * </HoverCard>
 * ```
 */
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Root controller for an open/closed hover card (Radix passthrough).
 *
 * @remarks
 * Accepts `openDelay`/`closeDelay` to tune how long a hover must dwell before the card appears
 * (and lingers after the cursor leaves).
 */
export const HoverCard = HoverCardPrimitive.Root;

/** Element that reveals the card on hover/focus; pass `asChild` to wrap a real control. */
export const HoverCardTrigger = HoverCardPrimitive.Trigger;

/**
 * The floating preview card; rendered through a portal.
 *
 * @remarks
 * Defaults to `align="center"` and `sideOffset={4}` to match the other floating surfaces, and to
 * a comfortable `w-64` reading width with `p-4` padding. Holds read-only preview content — for
 * interactive items use a menu instead.
 */
export function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>): React.JSX.Element {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-surface text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-64 origin-[var(--radix-hover-card-content-transform-origin)] rounded-lg border p-4 shadow-md outline-none',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
