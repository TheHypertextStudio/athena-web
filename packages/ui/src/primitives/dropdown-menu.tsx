/**
 * `@docket/ui` — DropdownMenu primitive family (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-dropdown-menu`. Re-exports the unstyled passthrough roots
 * ({@link DropdownMenu}, {@link DropdownMenuTrigger}, {@link DropdownMenuGroup},
 * {@link DropdownMenuPortal}, {@link DropdownMenuSub}, {@link DropdownMenuRadioGroup})
 * and provides token-styled wrappers for the visible surfaces. All colors come from the
 * semantic design tokens in `@docket/ui/styles/globals.css`.
 */
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as React from 'react';

import { Check, ChevronRight, Circle } from '../icons';

import { cn } from '../lib/utils';
import { focusRingInset } from './focus';

/** Root controller for an open/closed dropdown menu (Radix passthrough). */
export const DropdownMenu = DropdownMenuPrimitive.Root;

/** Element that toggles the menu open (Radix passthrough). */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Logical grouping of menu items (Radix passthrough). */
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

/** Portal that renders menu content into the document body (Radix passthrough). */
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

/** Nested submenu controller (Radix passthrough). */
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

/** Radio-item grouping with single-selection semantics (Radix passthrough). */
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/** Submenu trigger row; pass `inset` to align with items that have a leading indicator. */
export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        'focus:bg-surface-container-highest data-[state=open]:bg-surface-container-highest text-body flex cursor-default items-center rounded-sm px-2 py-1.5 outline-none select-none',
        focusRingInset,
        inset && 'pl-8',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

/** Floating panel that holds a submenu's items. */
export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-lg duration-(--dur-base) ease-(--ease-out)',
        className,
      )}
      {...props}
    />
  );
}

/** Floating panel that holds the menu's items; rendered through a portal. */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md duration-(--dur-base) ease-(--ease-out)',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/** Selectable menu item; pass `inset` to align with checkable items. */
export function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface text-body relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        focusRingInset,
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

/** Menu item with a checkbox indicator bound to the `checked` prop. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface text-body relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        focusRingInset,
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

/** Menu item with a radio indicator; one per {@link DropdownMenuRadioGroup} is active. */
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface text-body relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        focusRingInset,
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

/** Non-interactive section heading; pass `inset` to align with checkable items. */
export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('text-body px-2 py-1.5 font-semibold', inset && 'pl-8', className)}
      {...props}
    />
  );
}

/** Thin divider rule between menu sections. */
export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('bg-outline-variant -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

/** Muted, right-aligned keyboard-shortcut hint for a menu item. */
export function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span className={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...props} />
  );
}
