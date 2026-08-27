/**
 * `@docket/ui` — Popover primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-popover`. Re-exports the unstyled passthrough roots
 * ({@link Popover}, {@link PopoverTrigger}, {@link PopoverAnchor}) and provides a
 * token-styled {@link PopoverContent} surface. Unlike {@link DropdownMenuContent}, a
 * popover does NOT trap typeahead or impose `menu`/`menuitem` roles, so it is the right
 * floating surface for a *searchable* picker whose body is a real text `<input>` plus a
 * roving `listbox`. All colors come from the semantic design tokens in
 * `@docket/ui/styles/globals.css`.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';
import { menuContentClass } from './menu-styles';
import { OVERLAY_COLLISION_PADDING } from './overlay-inset';

/** Root controller for an open/closed popover (Radix passthrough). */
export const Popover = PopoverPrimitive.Root;

/** Element that toggles the popover open (Radix passthrough). */
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** Minimal geometry contract accepted by Radix for virtual popover anchors. */
export interface PopoverVirtualAnchor {
  readonly getBoundingClientRect: () => DOMRect;
}

/** Standard nullable React ref used to position a popover from consumer-owned geometry. */
export type PopoverVirtualAnchorRef = React.RefObject<PopoverVirtualAnchor | null>;

type RadixPopoverAnchorProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>;

/** Props for a positioning anchor decoupled from the popover trigger. */
export interface PopoverAnchorProps extends Omit<RadixPopoverAnchorProps, 'virtualRef'> {
  readonly virtualRef?: PopoverVirtualAnchorRef | undefined;
}

/** Optional positioning anchor decoupled from the trigger. */
export const PopoverAnchor = React.forwardRef<HTMLDivElement, PopoverAnchorProps>(
  ({ virtualRef, ...props }, forwardedRef) => (
    <PopoverPrimitive.Anchor
      {...props}
      ref={forwardedRef}
      {...(virtualRef !== undefined ? { virtualRef } : {})}
    />
  ),
);
PopoverAnchor.displayName = PopoverPrimitive.Anchor.displayName;

/**
 * Floating panel that holds the popover body; rendered through a portal.
 *
 * @remarks
 * Renders {@link DropdownMenuContent}'s exact surface — same `menuContentClass`, so the same
 * 16dp corner, 4dp padding, `level2` elevation, motion, and submenu shape morphing — as a plain
 * region with no `menu` semantics, so it can host arbitrary interactive content. Defaults to
 * `align="start"` so a property picker's panel left-edge lines up with its compact trigger
 * rather than centering under it.
 *
 * Every searchable picker in the product is a menu wearing a popover, so the surface comes from
 * one string and this overrides only what is popover-specific.
 *
 * Layering: transient overlays (this, dropdown/context menus, tooltips, hover cards) sit at
 * `z-[120]` — above the modal layer (sheets `z-[100]`, dialogs `z-[110]`) — so a picker opened
 * from inside a dialog renders over it instead of behind the scrim.
 */
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  collisionPadding = OVERLAY_COLLISION_PADDING,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          menuContentClass('standard'),
          'max-h-[var(--radix-popover-content-available-height)] min-h-0 w-72 origin-[var(--radix-popover-content-transform-origin)] outline-none',
          focusRing,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
