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
 * surface, `tw-animate-css` motion, and the {@link menuFocusRing} keyboard ring on every row.
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
import { OVERLAY_COLLISION_PADDING } from './overlay-inset';
import {
  MENU_INDICATOR_GUTTER,
  type MenuSections,
  type MenuVariant,
  type MenuWidth,
  menuBadge,
  menuCheckedItemClass,
  MENU_VIEWPORT_FIT,
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
 * File-local channel carrying the section treatment down to every group and separator, for the
 * same reason the variant has one: the choice is made once on the content, and a group has to
 * know whether it is the thing painting the surface or a bare semantic wrapper.
 */
const ContextMenuSectionsContext = React.createContext<MenuSections>('divider');

/** Read the section treatment published by the nearest {@link ContextMenuContent}. */
function useContextMenuSections(): MenuSections {
  return React.useContext(ContextMenuSectionsContext);
}

/** Root controller for an open/closed context menu (Radix passthrough). */
export const ContextMenu = ContextMenuPrimitive.Root;

/** The region whose right-click / long-press opens the menu at the cursor (Radix passthrough). */
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

/**
 * A block of related rows — the spec's "Grouped" layout configuration.
 *
 * @remarks
 * Collects its rows into an 8dp-radius block with 2dp of padding and 2dp between groups. Same
 * builder the {@link DropdownMenuGroup} uses, so the two render identically.
 */
export function ContextMenuGroup({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>): React.JSX.Element {
  const variant = useContextMenuVariant();
  const sections = useContextMenuSections();
  return (
    <ContextMenuPrimitive.Group
      className={cn(menuGroup(variant, sections), className)}
      {...props}
    />
  );
}

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
  inset?: boolean | undefined;
}): React.JSX.Element {
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.SubTrigger
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
    </ContextMenuPrimitive.SubTrigger>
  );
}

/** Floating panel that holds a submenu's items. */
export function ContextMenuSubContent({
  className,
  collisionPadding = OVERLAY_COLLISION_PADDING,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>): React.JSX.Element {
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.SubContent
      collisionPadding={collisionPadding}
      className={cn(
        menuContentClass(variant),
        // Grow from the Radix-provided transform origin rather than from the panel's centre.
        'origin-[var(--radix-context-menu-content-transform-origin)]',
        MENU_VIEWPORT_FIT.context,
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
  collisionPadding = OVERLAY_COLLISION_PADDING,
  width = 'md',
  sections = 'divider',
  variant = 'standard',
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  /** Tonal family for this menu and all its rows. Defaults to the surface-based `'standard'`. */
  variant?: MenuVariant | undefined;
  /**
   * How this menu separates its sections: a hairline `divider` (the default) or a `gap`, which
   * splits the menu into separately painted blocks. Pick one — they are alternatives, and a menu
   * that uses both reads as two competing groupings of the same rows.
   */
  sections?: MenuSections | undefined;
  /**
   * One of the four {@link MENU_WIDTH} steps. Defaults to `md` (224px). Pass a step rather than
   * a `min-w-*`/`w-*` class: the open set produced seven different widths across the product.
   */
  width?: MenuWidth | undefined;
}): React.JSX.Element {
  return (
    <ContextMenuVariantContext.Provider value={variant}>
      <ContextMenuSectionsContext.Provider value={sections}>
        <ContextMenuPrimitive.Portal>
          <ContextMenuPrimitive.Content
            collisionPadding={collisionPadding}
            className={cn(
              menuContentClass(variant, width, sections),
              // Scrollable within the viewport, growing from the Radix transform origin.
              'origin-[var(--radix-context-menu-content-transform-origin)]',
              MENU_VIEWPORT_FIT.context,
              className,
            )}
            {...props}
          />
        </ContextMenuPrimitive.Portal>
      </ContextMenuSectionsContext.Provider>
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
  selected = false,
  children,
  supporting,
  badge,
  trailingText,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  /** Add left padding so the label aligns with checkable items. */
  inset?: boolean | undefined;
  /** Optional quieter second line rendered beneath the label (anatomy #10). */
  supporting?: React.ReactNode | undefined;
  /** Optional trailing pill, e.g. a count or status (anatomy #5). */
  badge?: React.ReactNode | undefined;
  /** Optional trailing meta/shortcut hint (anatomy #6). */
  trailingText?: React.ReactNode | undefined;
  /**
   * Render the row in its selected state — the spec's `menu-item.selected.*` roles and its 12dp
   * corner. For rows whose selection the menu does not own itself: the active workspace, the
   * open tab, the current view. A call site that tints its own row instead is how a menu ends up
   * with two different selection colours.
   */
  selected?: boolean | undefined;
}): React.JSX.Element {
  const variant = useContextMenuVariant();
  const hasRichAnatomy = supporting != null || badge != null || trailingText != null;

  return (
    <ContextMenuPrimitive.Item
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
        menuCheckedItemClass(variant),
        MENU_INDICATOR_GUTTER,
        menuFocusRing,
        className,
      )}
      {...(checked !== undefined ? { checked } : {})}
      {...props}
    >
      <span className="absolute left-4 flex size-5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="size-5" />
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
        menuCheckedItemClass(variant),
        MENU_INDICATOR_GUTTER,
        menuFocusRing,
        className,
      )}
      {...props}
    >
      <span className="absolute left-4 flex size-5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="size-2.5 fill-current" />
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
  inset?: boolean | undefined;
}): React.JSX.Element {
  const variant = useContextMenuVariant();
  return (
    <ContextMenuPrimitive.Label
      className={cn(menuLabel(variant), { [MENU_INDICATOR_GUTTER]: inset }, className)}
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
