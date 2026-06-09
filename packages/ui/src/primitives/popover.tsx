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

/** Optional positioning anchor decoupled from the trigger (Radix passthrough). */
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Floating panel that holds the popover body; rendered through a portal.
 *
 * @remarks
 * Mirrors {@link DropdownMenuContent}'s token surface and enter/exit animations, but as a
 * plain region (no `menu` semantics) so it can host arbitrary interactive content. Defaults
 * to `align="start"` so a property picker's panel left-edge lines up with its compact
 * trigger rather than centering under it.
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
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-[var(--radix-popover-content-available-height)] w-72 origin-[var(--radix-popover-content-transform-origin)] rounded-md border p-0 shadow-md outline-none',
          focusRing,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
