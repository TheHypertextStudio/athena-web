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
 * {@link menuFocusRing} keyboard ring on every row.
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
import { OVERLAY_COLLISION_PADDING } from './overlay-inset';
import {
  MENU_INDICATOR_GUTTER,
  type MenuSections,
  type MenuVariant,
  type MenuWidth,
  menuBadge,
  menuCheckedItemClass,
  menuContentClass,
  menuFocusRing,
  menuGroup,
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
 * File-local channel carrying the section treatment down to every group and separator, for the
 * same reason the variant has one: the choice is made once on the content, and a group has to
 * know whether it is the thing painting the surface or a bare semantic wrapper.
 */
const DropdownMenuSectionsContext = React.createContext<MenuSections>('divider');

/** Read the section treatment published by the nearest {@link DropdownMenuContent}. */
function useDropdownMenuSections(): MenuSections {
  return React.useContext(DropdownMenuSectionsContext);
}

/** Root controller for an open/closed dropdown menu (Radix passthrough). */
export const DropdownMenu = DropdownMenuPrimitive.Root;

/** Element that toggles the menu open (Radix passthrough). */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/**
 * A block of related rows — the spec's "Grouped" layout configuration.
 *
 * @remarks
 * Collects its rows into an 8dp-radius block with 2dp of padding and 2dp between groups, so a
 * long menu reads as sections without needing a rule between them. Rows keep their own 4dp
 * corners, and the group's first and last rows take the 12dp edge corner.
 */
export function DropdownMenuGroup({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  const sections = useDropdownMenuSections();
  return (
    <DropdownMenuPrimitive.Group
      className={cn(menuGroup(variant, sections), className)}
      {...props}
    />
  );
}

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
        // Keep the open submenu lit with the same low-emphasis tonal overlay as a focused row.
        variant === 'vibrant'
          ? 'data-[state=open]:bg-on-tertiary-container/10'
          : 'data-[state=open]:bg-on-surface/8',
        menuFocusRing,
        { [MENU_INDICATOR_GUTTER]: inset },
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
  collisionPadding = OVERLAY_COLLISION_PADDING,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  return (
    <DropdownMenuPrimitive.SubContent
      collisionPadding={collisionPadding}
      className={cn(menuContentClass(variant), className)}
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
  collisionPadding = OVERLAY_COLLISION_PADDING,
  width = 'md',
  sections = 'divider',
  variant = 'standard',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /** Tonal family for this menu and all its rows. Defaults to the surface-based `'standard'`. */
  variant?: MenuVariant;
  /**
   * How this menu separates its sections: a hairline `divider` (the default) or a `gap`, which
   * splits the menu into separately painted blocks. Pick one — they are alternatives, and a menu
   * that uses both reads as two competing groupings of the same rows.
   */
  sections?: MenuSections;
  /**
   * One of the four {@link MENU_WIDTH} steps. Defaults to `md` (224px). Pass a step rather than
   * a `min-w-*`/`w-*` class: the open set produced seven different widths across the product.
   */
  width?: MenuWidth;
}): React.JSX.Element {
  return (
    <DropdownMenuVariantContext.Provider value={variant}>
      <DropdownMenuSectionsContext.Provider value={sections}>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
              menuContentClass(variant, width, sections),
              // Scrollable within the available viewport height Radix measures for us.
              'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-x-hidden overflow-y-auto',
              className,
            )}
            {...props}
          />
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuSectionsContext.Provider>
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
  selected = false,
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
  /**
   * Render the row in its selected state — the spec's `menu-item.selected.*` roles and its 12dp
   * corner. For rows whose selection the menu does not own itself: the active workspace, the
   * open tab, the current view. A call site that tints its own row instead is how a menu ends up
   * with two different selection colours.
   */
  selected?: boolean;
}): React.JSX.Element {
  const variant = useDropdownMenuVariant();
  const hasRichAnatomy = supporting != null || badge != null || trailingText != null;

  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        menuItemClass(variant, { selected }),
        menuFocusRing,
        { [MENU_INDICATOR_GUTTER]: inset },
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
        menuCheckedItemClass(variant),
        MENU_INDICATOR_GUTTER,
        menuFocusRing,
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-4 flex size-5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-5" />
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
        menuCheckedItemClass(variant),
        MENU_INDICATOR_GUTTER,
        menuFocusRing,
        className,
      )}
      {...props}
    >
      <span className="absolute left-4 flex size-5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-2.5 fill-current" />
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
      className={cn(menuLabel(variant), { [MENU_INDICATOR_GUTTER]: inset }, className)}
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
