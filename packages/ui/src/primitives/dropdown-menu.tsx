'use client';

/**
 * `@docket/ui` — DropdownMenu primitive family (MD3-expressive, shadcn "new-york" lineage).
 *
 * @remarks
 * Hand-authored over `@radix-ui/react-dropdown-menu`. Re-exports the unstyled passthrough roots
 * ({@link DropdownMenu}, {@link DropdownMenuTrigger}, {@link DropdownMenuGroup},
 * {@link DropdownMenuPortal}, {@link DropdownMenuSub}, {@link DropdownMenuRadioGroup}) and layers
 * the Docket look onto the visible surfaces through the shared, file-internal `menu-styles`
 * helper — the same source of truth the right-click {@link ContextMenu} family draws from, so the
 * two render identically: MD3 tonal surface, `tw-animate-css` motion, and the
 * {@link focusRingInset} keyboard ring on every row.
 *
 * ## Variants
 *
 * {@link DropdownMenuContent} accepts an optional `variant` (`'standard'` | `'vibrant'`, default
 * `'standard'`). The choice is published to every descendant row, label, and separator through a
 * file-local React context, so a single prop retones the whole menu. `standard` is the neutral
 * surface-based menu; `vibrant` is the high-emphasis tertiary-based menu (use sparingly). Both are
 * theme-aware in light and dark.
 *
 * ## Rich items
 *
 * {@link DropdownMenuItem} supports the full MD3 list-item anatomy through optional props —
 * `supporting` (a quieter second line under the label), `badge` (a trailing pill), and
 * `trailingText` (a trailing meta/shortcut hint) — in addition to the existing leading-icon slot
 * (an icon in `children`) and {@link DropdownMenuShortcut}. All are additive: existing call sites
 * that pass a plain label keep their exact prior layout.
 *
 * @example
 * ```tsx
 * <DropdownMenu>
 *   <DropdownMenuTrigger asChild>
 *     <Button>Actions</Button>
 *   </DropdownMenuTrigger>
 *   <DropdownMenuContent>
 *     <DropdownMenuItem onSelect={rename}>Rename</DropdownMenuItem>
 *     <DropdownMenuItem onSelect={remove} supporting="Cannot be undone">Delete</DropdownMenuItem>
 *     <DropdownMenuSeparator />
 *     <DropdownMenuItem onSelect={pin} badge="New">Pin to top</DropdownMenuItem>
 *   </DropdownMenuContent>
 * </DropdownMenu>
 * ```
 */
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
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
 * File-local channel carrying the active {@link MenuVariant} from {@link DropdownMenuContent} down
 * to every row, label, and separator. Not exported: variant is chosen once on the content and
 * every descendant reads it, so no call site threads it by hand.
 */
const DropdownMenuVariantContext = React.createContext<MenuVariant>('standard');

/** Read the active menu variant published by the nearest {@link DropdownMenuContent}. */
function useDropdownMenuVariant(): MenuVariant {
  return React.useContext(DropdownMenuVariantContext);
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
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.SubTrigger
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
    </DropdownMenuPrimitive.SubTrigger>
  );
}

/** Floating panel that holds a submenu's items. */
export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        menuContentClass(variant),
        // Submenus float above their parent surface, so they carry a slightly deeper shadow.
        'shadow-lg',
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
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  variant = 'standard',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /** Tonal family for this menu and all its rows. Defaults to the surface-based `'standard'`. */
  variant?: MenuVariant;
}): React.JSX.Element {
  return (
    <DropdownMenuVariantContext.Provider value={variant}>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          sideOffset={sideOffset}
          className={cn(
            menuContentClass(variant),
            // Scrollable within the available viewport height Radix measures for us.
            'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-x-hidden overflow-y-auto',
            className,
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuVariantContext.Provider>
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
export function DropdownMenuItem({
  className,
  inset,
  children,
  supporting,
  badge,
  trailingText,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean;
  /** Optional quieter second line rendered beneath the label (anatomy #10). */
  supporting?: React.ReactNode;
  /** Optional trailing pill, e.g. a count or status (anatomy #5). */
  badge?: React.ReactNode;
  /** Optional trailing meta/shortcut hint (anatomy #6). */
  trailingText?: React.ReactNode;
}): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  const hasRichAnatomy = supporting != null || badge != null || trailingText != null;

  return (
    <DropdownMenuPrimitive.Item
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
    </DropdownMenuPrimitive.Item>
  );
}

/** Menu item with a checkbox indicator bound to the `checked` prop. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.CheckboxItem
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
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.RadioItem
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
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.Label
      className={cn(menuLabel(variant), inset && 'pl-8', className)}
      {...props}
    />
  );
}

/** Thin divider rule between menu sections. */
export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.Separator className={cn(menuSeparator(variant), className)} {...props} />
  );
}

/** Muted, right-aligned keyboard-shortcut hint for a menu item. */
export function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  return <span className={cn(menuTrailingText(variant), className)} {...props} />;
}
