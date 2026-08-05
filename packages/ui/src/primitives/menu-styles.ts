/**
 * `@docket/ui` — INTERNAL menu color-role helper (MD3 expressive).
 *
 * @remarks
 * This module is deliberately **not** re-exported from `./index`. It exists only so the
 * {@link DropdownMenu} and {@link ContextMenu} primitive families — a dropdown and its
 * right-click sibling — render byte-identically from a single source of truth. Both menu
 * files import these builders and use them verbatim; nothing outside `packages/ui/src/primitives`
 * should depend on this file.
 *
 * ## Two variants
 *
 * MD3-expressive menus come in two tonal families, both fully theme-aware (the class strings
 * are semantic Tailwind utilities that resolve in light and dark automatically):
 *
 * - **`standard`** — the default, surface-based menu. Neutral `surface-container-low`
 *   container with `on-surface` text; selected rows lift into the `secondary-container`
 *   accent. This is what almost every menu should use.
 * - **`vibrant`** — a high-emphasis, tertiary-based menu (use sparingly). The whole
 *   container is `tertiary-container`; selected rows escalate to solid `tertiary`.
 *
 * ## Selection colour
 *
 * A checked row uses **`secondary-container`**, the MD3 selection role — the same role the spec
 * gives a navigation drawer's active indicator and a selected list item. It was `tertiary-container`
 * (hue 330), which rendered a checked "Dates" or "Default" row as a magenta block: a decorative
 * accent on a control whose whole job is to be quiet. `secondary-container` sits on the same hue as
 * the surface ramp, so a checked row reads as *selected* rather than as *coloured*.
 *
 * ## Menu anatomy → color role
 *
 * | # | Part                | standard                        | vibrant                       |
 * |---|---------------------|---------------------------------|-------------------------------|
 * | 1 | leading icon        | `on-surface-variant`            | `on-tertiary-container`       |
 * | 2 | item text           | `on-surface`                    | `on-tertiary-container`       |
 * | 3 | item state layer    | `on-surface` overlay            | `on-tertiary-container` overlay |
 * | 4 | container           | `surface-container-low`         | `tertiary-container`          |
 * | 5 | badge               | `on-surface-variant`            | `on-tertiary-container`       |
 * | 6 | trailing text       | `on-surface-variant`            | `on-tertiary-container`       |
 * | 7 | selected item bg    | `secondary-container`           | `tertiary`                    |
 * | 8 | selected content    | `on-secondary-container`        | `on-tertiary`                 |
 * | 9 | label text          | `on-surface-variant`            | `on-tertiary-container`       |
 * | 10| supporting text     | `on-surface-variant`            | `on-tertiary-container`       |
 * | 11| selected divider    | `on-secondary-container`        | `on-tertiary`                 |
 */
import { cn } from '../lib/utils';
import { CONTROL } from './control';

/**
 * The menu row's metrics: the `lg` step of the shared control scale.
 *
 * Exported so the primitive tests can assert that the literal class strings below and the control
 * scale have not drifted apart — the strings must stay literal for Tailwind's static extractor,
 * which means the only way to keep them honest is to check them.
 *
 * @remarks
 * Verified against the Material Web token source rather than recalled:
 * `tokens/_md-comp-menu.scss` gives `container-elevation: level2` (a 3dp shadow — menus are the
 * one surface where a shadow is correct, because they float over arbitrary content),
 * `container-shape: corner-extra-small`, and `top-space`/`bottom-space` of `8px`.
 * `tokens/versions/v0_192/_md-comp-list.scss` gives the row anatomy: `list-item-leading-space`
 * and `list-item-trailing-space` of `16px`, `list-item-leading-icon-size` of `24px`, and
 * `list-item-one-line-container-height` of `56px`.
 *
 * Docket keeps MD3's *total* 16px leading inset — 8px of menu padding plus 8px of row padding —
 * but takes the row height and icon size from the `lg` control step (36px rows, 18px icons)
 * rather than MD3's phone-scale 56px rows and 24px icons. A 56px menu row in a desktop command
 * surface is not a faithful implementation of the spec, it is a spec applied to the wrong device.
 * The container radius steps up to the container radius (10px) rather than MD3's 4px so the menu
 * reads as a container holding 8px-radius controls, not as another control.
 */
export const MENU_METRICS = CONTROL.lg;

/** Which MD3 tonal family a menu surface renders in. See the module remarks. */
export type MenuVariant = 'standard' | 'vibrant';

/**
 * Shared, variant-independent structural classes for the floating menu surface.
 *
 * @remarks
 * Preserves the radius, padding, `min-w`, shadow, `overflow`, `z-[120]` stacking, and the
 * `tw-animate-css` open/close motion that both menu contents already carried. Color roles are
 * layered on top by {@link menuContentClass}; primitive-specific bits (a `max-h-[…]` clamp or a
 * `origin-[…]` transform) are appended by each menu file after this base.
 */
const menuContentBase =
  'z-[120] min-w-[8rem] overflow-hidden rounded-lg border p-2 shadow-md ' +
  'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ' +
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'duration-(--dur-base) ease-(--ease-out)';

/**
 * Full class string for the menu container surface (anatomy #4 + #7 wrapper).
 *
 * @param variant - `'standard'` (surface-based) or `'vibrant'` (tertiary-based).
 * @returns The structural base plus this variant's container/border/text roles.
 *
 * @example
 * ```tsx
 * <DropdownMenuPrimitive.Content
 *   className={cn(menuContentClass('standard'), 'max-h-[var(--radix-dropdown-menu-content-available-height)]')}
 * />
 * ```
 */
export function menuContentClass(variant: MenuVariant): string {
  return cn(
    menuContentBase,
    variant === 'vibrant'
      ? 'bg-tertiary-container text-on-tertiary-container border-on-tertiary-container/20'
      : 'bg-surface-container-low text-on-surface border-outline-variant',
  );
}

/** Shared, variant-independent structural classes for an interactive menu row. */
const menuItemBase =
  'relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 py-1.5 ' +
  'text-body-medium transition-colors outline-none select-none ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ' +
  '[&_svg]:pointer-events-none [&_svg]:size-4.5! [&_svg]:shrink-0';

/** Options accepted by {@link menuItemClass}. */
export interface MenuItemClassOptions {
  /** Render the row in its selected state (anatomy #7 background + #8 content color). */
  selected?: boolean;
}

/**
 * Full class string for an interactive menu row (anatomy #1 icon + #2 text + #3 state layer,
 * and, when `selected`, #7 background + #8 content).
 *
 * @param variant - `'standard'` (surface-based) or `'vibrant'` (tertiary-based).
 * @param options - Pass `{ selected: true }` for the selected/active row.
 * @returns The row's complete color + state-layer class string (structural base included).
 *
 * @remarks
 * The `focus:` state layer doubles as the hover affordance because Radix drives roving focus on
 * pointer move — a focused row IS the hovered row. Standard rows use a subtle `on-surface`
 * tint; vibrant rows tint with `on-tertiary-container`. `focusRingInset` (the keyboard ring) is
 * still applied separately by each menu file, unchanged.
 *
 * @example
 * ```tsx
 * <DropdownMenuPrimitive.Item className={cn(menuItemClass('standard', { selected }), focusRingInset)} />
 * ```
 */
export function menuItemClass(variant: MenuVariant, options?: MenuItemClassOptions): string {
  const selected = options?.selected ?? false;

  if (variant === 'vibrant') {
    return cn(
      menuItemBase,
      selected
        ? 'bg-tertiary text-on-tertiary focus:bg-tertiary focus:text-on-tertiary'
        : 'text-on-tertiary-container hover:bg-on-tertiary-container/10 focus:bg-on-tertiary-container/10',
    );
  }

  return cn(
    menuItemBase,
    selected
      ? 'bg-secondary-container text-on-secondary-container focus:bg-secondary-container focus:text-on-secondary-container'
      : 'text-on-surface hover:bg-on-surface/8 focus:bg-on-surface/8',
  );
}

/**
 * Class string for a section label / group heading (anatomy #9).
 *
 * @param variant - Menu tonal family.
 * @returns Label typography + color, matching the menu's padding rhythm.
 */
export function menuLabel(variant: MenuVariant): string {
  return cn(
    'text-label-medium px-2 py-1.5',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}

/**
 * Class string for a divider rule between groups (anatomy #11).
 *
 * @param variant - Menu tonal family. The divider is tinted with the variant's
 *   selected-content role so it reads as part of the tonal family rather than a hard line.
 * @returns The separator's geometry + tinted background.
 *
 * @remarks
 * Inset within the container's own padding, not bled edge-to-edge. The 2025 MD3 "expressive"
 * menu redesign explicitly calls this out: dividers (and the current selection) no longer span
 * the container's full width — both now respect the same inset every row does, so a divider
 * reads as a rule *between* rows rather than a seam in the container itself. A selected row is
 * already inset this way (`menuItemClass`'s `rounded-md` sits inside the content's `p-2`); this
 * function used to fight that with a `-mx-2` bleed that canceled the container padding on
 * purpose. Dropping the bleed is the whole fix — the surrounding `p-2` does the rest.
 */
export function menuSeparator(variant: MenuVariant): string {
  return cn('my-1 h-px', variant === 'vibrant' ? 'bg-on-tertiary/25' : 'bg-outline-variant');
}

/**
 * Class string for an optional badge (anatomy #5) — a compact trailing pill.
 *
 * @param variant - Menu tonal family.
 * @returns Badge chrome + the variant's badge color role.
 */
export function menuBadge(variant: MenuVariant): string {
  return cn(
    'ml-auto inline-flex items-center rounded-full px-1.5 text-label-small tabular-nums',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}

/**
 * Class string for optional trailing text (anatomy #6) — e.g. a shortcut hint or meta value.
 *
 * @param variant - Menu tonal family.
 * @returns Trailing-text typography + the variant's trailing color role.
 */
export function menuTrailingText(variant: MenuVariant): string {
  return cn(
    'ml-auto text-label-small',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}

/**
 * Class string for optional supporting text (anatomy #10) — a quieter second line under the
 * item text.
 *
 * @param variant - Menu tonal family.
 * @returns Supporting-line typography + the variant's supporting color role.
 */
export function menuSupporting(variant: MenuVariant): string {
  return cn(
    'text-body-small',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}
