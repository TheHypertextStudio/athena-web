/**
 * `@docket/ui` — ContextMenu primitive family (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-context-menu`. A context menu is the right-click (or long-press) sibling of
 * {@link DropdownMenu}: identical surface, items, and semantics, but opened from a
 * {@link ContextMenuTrigger} region at the pointer rather than from a clicked button. It is the
 * inline-action affordance the Phase A review asked for — right-click a list row to act on it
 * without leaving the keyboard-reachable {@link DropdownMenu} path intact elsewhere.
 *
 * Radix supplies the behaviour for free: right-click/long-press open at the cursor, typeahead,
 * roving focus, `menu`/`menuitem` roles, submenu nesting, and `Escape`/outside-click dismiss.
 * This module only adds the Docket look, matched byte-for-byte to {@link DropdownMenuContent}'s
 * MD3 tonal surface and `tw-animate-css` motion, plus the shared {@link focusRingInset} keyboard
 * ring on every interactive row.
 *
 * The unstyled passthrough roots are re-exported verbatim; the visible surfaces are token-styled
 * wrappers. All colors come from the semantic design tokens in `@docket/ui/styles/globals.css`.
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenuTrigger asChild>
 *     <ListRow … />
 *   </ContextMenuTrigger>
 *   <ContextMenuContent>
 *     <ContextMenuItem onSelect={rename}>Rename</ContextMenuItem>
 *     <ContextMenuSeparator />
 *     <ContextMenuItem onSelect={remove}>Delete</ContextMenuItem>
 *   </ContextMenuContent>
 * </ContextMenu>
 * ```
 */
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as React from 'react';

import { Check, ChevronRight, Circle } from '../icons';

import { cn } from '../lib/utils';
import { focusRingInset } from './focus';

/** Root controller for an open/closed context menu (Radix passthrough). */
export const ContextMenu = ContextMenuPrimitive.Root;

/** The region whose right-click / long-press opens the menu at the cursor (Radix passthrough). */
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

/** Logical grouping of menu items (Radix passthrough). */
export const ContextMenuGroup = ContextMenuPrimitive.Group;

/** Portal that renders menu content into the document body (Radix passthrough). */
export const ContextMenuPortal = ContextMenuPrimitive.Portal;

/** Nested submenu controller (Radix passthrough). */
export const ContextMenuSub = ContextMenuPrimitive.Sub;

/** Radio-item grouping with single-selection semantics (Radix passthrough). */
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/** Submenu trigger row; pass `inset` to align with items that have a leading indicator. */
export function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
}): React.JSX.Element {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface data-[state=open]:bg-surface-container-highest flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        focusRingInset,
        inset && 'pl-8',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

/** Floating panel that holds a submenu's items. */
export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.SubContent
      className={cn(
        'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-[var(--radix-context-menu-content-transform-origin)] overflow-hidden rounded-md border p-1 shadow-lg',
        className,
      )}
      {...props}
    />
  );
}

/** Floating panel that holds the menu's items; rendered through a portal. */
export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          'bg-surface-container-high text-on-surface border-outline-variant data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-[8rem] origin-[var(--radix-context-menu-content-transform-origin)] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

/** Selectable menu item; pass `inset` to align with checkable items. */
export function ContextMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
}): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        focusRingInset,
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

/** Menu item with a checkbox indicator bound to the `checked` prop. */
export function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.CheckboxItem
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        focusRingInset,
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

/** Menu item with a radio indicator; one per {@link ContextMenuRadioGroup} is active. */
export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.RadioItem
      className={cn(
        'focus:bg-surface-container-highest focus:text-on-surface relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        focusRingInset,
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

/** Non-interactive section heading; pass `inset` to align with checkable items. */
export function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
}): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        'text-on-surface px-2 py-1.5 text-sm font-semibold',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

/** Thin divider rule between menu sections. */
export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('bg-outline-variant -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

/** Muted, right-aligned keyboard-shortcut hint for a menu item. */
export function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      className={cn('text-on-surface-variant ml-auto text-xs tracking-widest', className)}
      {...props}
    />
  );
}
