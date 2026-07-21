'use client';

/**
 * `@docket/ui` — ContextMenu primitive family (MD3-expressive, shadcn "new-york" lineage).
 *
 * @remarks
 * Hand-authored over `@radix-ui/react-context-menu`. A context menu is the right-click (or
 * long-press) sibling of {@link DropdownMenu}: identical surface, items, and semantics, but
 * opened from a {@link ContextMenuTrigger} region at the pointer rather than from a clicked
 * button. It is the inline-action affordance the Phase A review asked for — right-click a list
 * row to act on it while the keyboard-reachable {@link DropdownMenu} path stays intact elsewhere.
 *
 * Radix supplies the behaviour for free: right-click/long-press open at the cursor, typeahead,
 * roving focus, `menu`/`menuitem` roles, submenu nesting, and `Escape`/outside-click dismiss.
 * The Docket look is layered on through the shared, file-internal `menu-styles` helper so this
 * family renders identically to {@link DropdownMenuContent} from one source of truth — MD3 tonal
 * surface, `tw-animate-css` motion, and the {@link focusRingInset} keyboard ring on every row.
 *
 * ## Variants
 *
 * {@link ContextMenuContent} accepts an optional `variant` (`'standard'` | `'vibrant'`, default
 * `'standard'`). The choice is published to every descendant row/label/separator through a
 * file-local React context, so a single prop retones the whole menu. `standard` is the neutral
 * surface-based menu; `vibrant` is the high-emphasis tertiary-based menu (use sparingly). Both
 * are theme-aware in light and dark.
 *
 * ## Rich items
 *
 * {@link ContextMenuItem} supports the full MD3 list-item anatomy through optional props —
 * `supporting` (a quieter second line under the label), `badge` (a trailing pill), and
 * `trailingText` (a trailing meta/shortcut hint) — in addition to the existing leading-icon slot
 * (an icon in `children`) and {@link ContextMenuShortcut}. All are additive: existing call sites
 * that pass a plain label keep their exact prior layout.
 *
 * @example
 * ```tsx
 * <ContextMenu>
 *   <ContextMenuTrigger asChild>
 *     <ListRow … />
 *   </ContextMenuTrigger>
 *   <ContextMenuContent>
 *     <ContextMenuItem onSelect={rename}>Rename</ContextMenuItem>
 *     <ContextMenuItem onSelect={remove} supporting="Cannot be undone">Delete</ContextMenuItem>
 *     <ContextMenuSeparator />
 *     <ContextMenuItem onSelect={pin} badge="New">Pin to top</ContextMenuItem>
 *   </ContextMenuContent>
 * </ContextMenu>
 * ```
 */
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as React from 'react';

import { Check, ChevronRight, Circle } from '../icons';

import { cn } from '../lib/utils';
import { focusRingInset } from './focus';
import {
  type MenuVariant,
  menuBadge,
  menuContentClass,
  menuItemClass,
  menuLabel,
  menuSeparator,
  menuSupporting,
  menuTrailingText,
} from './menu-styles';

/**
 * File-local channel carrying the active {@link MenuVariant} from {@link ContextMenuContent} down
 * to every row, label, and separator. Not exported: variant is chosen once on the content and
 * every descendant reads it, so no call site threads it by hand.
 */
const ContextMenuVariantContext = React.createContext<MenuVariant>('standard');

/** Read the active menu variant published by the nearest {@link ContextMenuContent}. */
function useContextMenuVariant(): MenuVariant {
  return React.useContext(ContextMenuVariantContext);
}

/**
 * Scoped color utility for the leading glyph (anatomy #1), written as a literal per variant so
 * Tailwind's static extractor picks it up. Targets the first `<svg>` in the row — the icon a
 * caller places at the start of `children` — leaving the trailing chevron/indicator untouched.
 */
function leadingIconClass(variant: MenuVariant): string {
  return variant === 'vibrant'
    ? '[&_svg:first-child]:text-on-tertiary-container'
    : '[&_svg:first-child]:text-on-surface-variant';
}

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
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(
        menuItemClass(variant),
        leadingIconClass(variant),
        // Keep the open submenu lit with the same low-emphasis tonal overlay as a focused row.
        variant === 'vibrant'
          ? 'data-[state=open]:bg-on-tertiary-container/10'
          : 'data-[state=open]:bg-on-surface/8',
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
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.SubContent
      className={cn(
        menuContentClass(variant),
        // Submenus float above their parent surface, so they carry a slightly deeper shadow and
        // grow from the Radix-provided transform origin.
        'origin-[var(--radix-context-menu-content-transform-origin)] shadow-lg',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Floating panel that holds the menu's items; rendered through a portal.
 *
 * @remarks
 * Pass `variant` to retone the entire menu. The value is published to every descendant row,
 * label, and separator via context, so items style themselves without any per-item prop.
 */
export function ContextMenuContent({
  className,
  variant = 'standard',
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  /** Tonal family for this menu and all its rows. Defaults to the surface-based `'standard'`. */
  variant?: MenuVariant;
}): React.JSX.Element {
  return (
    <ContextMenuVariantContext.Provider value={variant}>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            menuContentClass(variant),
            // Scrollable within the viewport, growing from the Radix transform origin.
            'max-h-[var(--radix-context-menu-content-available-height)] origin-[var(--radix-context-menu-content-transform-origin)] overflow-x-hidden overflow-y-auto',
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Portal>
    </ContextMenuVariantContext.Provider>
  );
}

/**
 * Selectable menu item.
 *
 * @remarks
 * Backward-compatible: with only `children` it renders exactly as before (leading icon + label on
 * one line). The optional `supporting`, `badge`, and `trailingText` props opt into the fuller MD3
 * anatomy — leading icon · text (with `supporting` stacked beneath) · flexible gap ·
 * `badge` / `trailingText` / trailing icon.
 */
export function ContextMenuItem({
  className,
  inset,
  children,
  supporting,
  badge,
  trailingText,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
  /** Optional quieter second line rendered beneath the label (anatomy #10). */
  supporting?: React.ReactNode;
  /** Optional trailing pill, e.g. a count or status (anatomy #5). */
  badge?: React.ReactNode;
  /** Optional trailing meta/shortcut hint (anatomy #6). */
  trailingText?: React.ReactNode;
}): React.JSX.Element {
  const variant = useContextMenuVariant();
  const hasRichAnatomy = supporting != null || badge != null || trailingText != null;

  return (
    <ContextMenuPrimitive.Item
      className={cn(
        menuItemClass(variant),
        leadingIconClass(variant),
        focusRingInset,
        inset && 'pl-8',
        className,
      )}
      {...props}
    >
      {hasRichAnatomy ? (
        <>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2">{children}</span>
            {supporting != null ? (
              <span className={menuSupporting(variant)}>{supporting}</span>
            ) : undefined}
          </span>
          {badge != null ? <span className={menuBadge(variant)}>{badge}</span> : undefined}
          {trailingText != null ? (
            <span className={menuTrailingText(variant)}>{trailingText}</span>
          ) : undefined}
        </>
      ) : (
        children
      )}
    </ContextMenuPrimitive.Item>
  );
}

/** Menu item with a checkbox indicator bound to the `checked` prop. */
export function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>): React.JSX.Element {
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.CheckboxItem
      className={cn(
        menuItemClass(variant),
        // Radix drives the checked state; escalate the checked row into the variant's selected
        // background + content role (anatomy #7 + #8).
        variant === 'vibrant'
          ? 'data-[state=checked]:bg-tertiary data-[state=checked]:text-on-tertiary'
          : 'data-[state=checked]:bg-tertiary-container data-[state=checked]:text-on-tertiary-container',
        // Reserve the leading indicator gutter.
        'py-1.5 pr-2 pl-8',
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
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.RadioItem
      className={cn(
        menuItemClass(variant),
        // The selected radio row lifts into the variant's selected background + content role.
        variant === 'vibrant'
          ? 'data-[state=checked]:bg-tertiary data-[state=checked]:text-on-tertiary'
          : 'data-[state=checked]:bg-tertiary-container data-[state=checked]:text-on-tertiary-container',
        'py-1.5 pr-2 pl-8',
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
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.Label
      className={cn(menuLabel(variant), inset && 'pl-8', className)}
      {...props}
    />
  );
}

/** Thin divider rule between menu sections. */
export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>): React.JSX.Element {
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.Separator className={cn(menuSeparator(variant), className)} {...props} />
  );
}

/** Muted, right-aligned keyboard-shortcut hint for a menu item. */
export function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  const variant = useContextMenuVariant();
  return <span className={cn(menuTrailingText(variant), className)} {...props} />;
}
