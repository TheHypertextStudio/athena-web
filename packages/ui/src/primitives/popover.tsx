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
  readonly virtualRef?: PopoverVirtualAnchorRef;
}

/** Optional positioning anchor decoupled from the trigger. */
export const PopoverAnchor = React.forwardRef<HTMLDivElement, PopoverAnchorProps>(
  ({ virtualRef, ...props }, forwardedRef) => (
    <PopoverPrimitive.Anchor
      {...props}
      ref={forwardedRef}
      virtualRef={virtualRef as RadixPopoverAnchorProps['virtualRef']}
    />
  ),
);
PopoverAnchor.displayName = PopoverPrimitive.Anchor.displayName;

/**
 * Floating panel that holds the popover body; rendered through a portal.
 *
 * @remarks
 * Mirrors {@link DropdownMenuContent}'s token surface and enter/exit animations, but as a
 * plain region (no `menu` semantics) so it can host arbitrary interactive content. Defaults
 * to `align="start"` so a property picker's panel left-edge lines up with its compact
 * trigger rather than centering under it.
 *
 * Layering: transient overlays (this, dropdown/context menus, tooltips, hover cards) sit at
 * `z-[120]` — above the modal layer (sheets `z-[100]`, dialogs `z-[110]`) — so a picker opened
 * from inside a dialog renders over it instead of behind the scrim.
 */
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[120] max-h-[var(--radix-popover-content-available-height)] w-72 origin-[var(--radix-popover-content-transform-origin)] rounded-md border p-0 shadow-md duration-(--dur-base) ease-(--ease-out) outline-none',
          focusRing,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
