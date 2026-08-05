/**
 * `@docket/ui` — the menu style source (MD3 Expressive vertical menu).
 *
 * @remarks
 * This is the single place any menu-shaped surface in the product gets its geometry and colour
 * from. The {@link DropdownMenu} and {@link ContextMenu} primitive families, the pickers, the
 * command palette, the mention menu, and the editor's suggestion menu all import these builders
 * and use them verbatim. A surface that renders a list of choices on a temporary surface is a
 * menu, wherever it happens to live, and it gets its numbers here.
 *
 * The module used to be private to `primitives/`, which is exactly why six surfaces outside that
 * directory ended up hand-rolling their own: they could not reach it. Reaching it is now the
 * cheapest option, and `design-token-scan.ts` fails the build on the alternative.
 *
 * ## The spec these values come from
 *
 * Every number and colour role below is `md.comp.menus.*` from the M3 Expressive vertical menu,
 * transcribed in **`docs/design/references/md3-menus.md`** with the source revision. Read that
 * file before changing anything here. It exists because this module used to cite
 * `tokens/_md-comp-menu.scss` — the *baseline* menu, which M3 documents as legacy — and the
 * implementation silently drifted from the current spec on container shape, row height, icon
 * size, typography, and the selection colour role.
 *
 * ## Two colour mappings
 *
 * The spec gives menus exactly two, and {@link MenuVariant} is that choice:
 *
 * - **`standard`** — surface-based. `surface-container-low` container, `on-surface` label,
 *   `on-surface-variant` icons, selection in `tertiary-container`. Almost every menu.
 * - **`vibrant`** — tertiary-based, higher emphasis, "used sparingly" per the spec. The whole
 *   container is `tertiary-container` and selection escalates to solid `tertiary`. It is also
 *   the only mapping where icons change colour on interaction, shifting to `tertiary` while the
 *   label holds still.
 *
 * ## Why the class strings are literal
 *
 * Tailwind's extractor is static, so none of these can be composed from a variable. That makes
 * the strings the only place a number lives, which is why
 * `packages/ui/tests/primitives/design-contract.test.tsx` asserts each one against the spec
 * table rather than against another string.
 */
import { cn } from '../lib/utils';

/**
 * The vertical menu's measurements, straight from `Menus - Common`.
 *
 * @remarks
 * Exported so the primitive tests can check the literal class strings below against the spec
 * without re-deriving it. This is **not** a step on the shared `CONTROL` scale — it used to be
 * (`CONTROL.lg`, 36px rows and 18px icons), which is how the row drifted 8px short of the 44dp
 * the spec gives. A menu row is a spec'd component, not a control, so it carries its own metrics.
 *
 * @see {@link https://m3.material.io/components/menus/specs} and
 * `docs/design/references/md3-menus.md`.
 */
export const MENU_METRICS = {
  /** `menu-item.height` — 44dp. */
  minHeight: 'min-h-11',
  minHeightPx: 44,
  /** `menu-item.leading-space` / `.trailing-space` — 16dp. */
  paddingX: 'px-4',
  paddingXPx: 16,
  /** `menu-item.top-space` / `.bottom-space` — 8dp. */
  paddingY: 'py-2',
  paddingYPx: 8,
  /** `menu-item.between-space` — 12dp. */
  gap: 'gap-3',
  gapPx: 12,
  /** `menu-item.leading-icon.size` / `.trailing-icon.size` — 20dp, applied to a row's `<svg>`s. */
  iconApply: '[&_svg]:size-5',
  /**
   * The same 20dp as a box for a leading slot that is not an `<svg>` — a picker option's avatar,
   * colour swatch, or multi-bar glyph, none of which `iconApply` can reach.
   */
  iconBox: 'size-5',
  iconPx: 20,
  /** Container padding. 16dp container corner less 4dp leaves the 12dp edge-row corner. */
  containerPadding: 'p-1',
  containerPaddingPx: 4,
  /** `menu-item.label-text` — `label-large`. */
  labelToken: 'label-large',
} as const;

/** Which of the spec's two colour mappings a menu surface renders in. See the module remarks. */
export type MenuVariant = 'standard' | 'vibrant';

/** How wide a menu container is. See {@link MENU_WIDTH}. */
export type MenuWidth = 'sm' | 'md' | 'lg' | 'xl';

/**
 * The four menu widths.
 *
 * @remarks
 * The expressive spec publishes no width at all, and the baseline's 112dp–280dp range is phone
 * scale, so this is Docket's. It is a closed set because the open one produced 176, 192, 224,
 * 240, 288, 352, and 384px across 26 call-site files, each written as its own `min-w-[14rem]` or
 * `w-56` — seven widths for what are, in practice, four jobs: a short action list, an ordinary
 * action list, a list with descriptions, and a list with paths or timestamps in it.
 *
 * Every one clamps to the viewport, so the widest menu still fits a 320px phone.
 */
export const MENU_WIDTH: Readonly<Record<MenuWidth, string>> = {
  /** 192px — a handful of one-word actions. */
  sm: 'min-w-48',
  /** 224px — the default: an action list with icons and labels. */
  md: 'min-w-56',
  /** 288px — rows carrying supporting text or a trailing value. */
  lg: 'min-w-72',
  /** 352px — rows carrying a path, a timestamp, or a workspace name. */
  xl: 'min-w-88',
};

/** The default width when a menu does not ask for one. */
export const DEFAULT_MENU_WIDTH: MenuWidth = 'md';

/**
 * Structural classes for the floating menu surface, shared by both mappings.
 *
 * @remarks
 * Carries `container.shape` (`corner.large`, 16dp), the 4dp container padding,
 * `container.elevation` (`level2`), and the open/close motion.
 *
 * **Shape morphing.** The spec gives a menu two container shapes: `active.container.shape`
 * (16dp) while it holds focus, and `inactive.container.shape` (8dp) once it has revealed a
 * submenu. Radix portals `SubContent` out of its parent, so the open `SubTrigger` stays inside
 * this element with `data-state="open"` — `has-data-[state=open]` is therefore exactly "a
 * submenu of mine is open". Checkbox and radio rows use `data-state="checked"`, so they do not
 * trip it. The `transition-[border-radius]` is collapsed to 0.01ms by the reduced-motion rule
 * in `globals.css`.
 *
 * There is no border. MD3 separates a menu from what it floats over with elevation and a tonal
 * step, and the spec's colour list for menus has no outline role in it.
 */
const menuContentBase =
  'z-[120] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-corner-lg p-1 shadow-level2 ' +
  'has-data-[state=open]:rounded-corner-sm transition-[border-radius] ' +
  'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ' +
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'duration-(--dur-base) ease-(--ease-out)';

/**
 * Full class string for the menu container surface.
 *
 * @param variant - Which colour mapping to render in.
 * @param width - One of the four {@link MENU_WIDTH} steps. Defaults to `md`.
 * @returns The structural base plus this mapping's container and default content roles.
 *
 * @example
 * ```tsx
 * <DropdownMenuPrimitive.Content className={cn(menuContentClass('standard'), MENU_OVERFLOW)} />
 * ```
 */
export function menuContentClass(
  variant: MenuVariant,
  width: MenuWidth = DEFAULT_MENU_WIDTH,
): string {
  return cn(
    menuContentBase,
    MENU_WIDTH[width],
    variant === 'vibrant'
      ? 'bg-tertiary-container text-on-tertiary-container'
      : 'bg-surface-container-low text-on-surface',
  );
}

/**
 * Structural classes for an interactive menu row, shared by both mappings.
 *
 * @remarks
 * `menu-item.shape` is `corner.extra-small` (4dp). The first and last rows take
 * `corner.medium` (12dp) on the edge facing the container and keep 4dp on the edge facing
 * their neighbour — that is what the spec's `inner-corner.corner-size` means, and it is what
 * makes a menu read as one shape rather than a stack of pills.
 *
 * Disabled is `opacity-38`, not `opacity-50`: 0.38 is the literal every MD3 disabled token
 * carries.
 */
const menuItemBase =
  'relative flex min-h-11 cursor-default items-center gap-3 px-4 py-2 ' +
  'rounded-corner-xs first:rounded-t-corner-md last:rounded-b-corner-md ' +
  'text-label-large transition-colors outline-none select-none ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-38 ' +
  '[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0';

/**
 * State-layer classes for an unselected row.
 *
 * @remarks
 * Three distinct steps, which is the part the previous implementation collapsed: hover 8%,
 * focus 10%, pressed 10%. Radix drives roving focus on pointer move, so a hovered row is also a
 * focused row — `focus:not-hover:` scopes the 10% focus layer to keyboard focus so a mouse
 * hover really does render at the spec's 8%. Without that guard the two states are
 * indistinguishable and every hover reads as a focus.
 */
const STATE_LAYER: Readonly<Record<MenuVariant, string>> = {
  standard: 'hover:bg-on-surface/8 focus:not-hover:bg-on-surface/10 active:bg-on-surface/10',
  vibrant:
    'hover:bg-on-tertiary-container/8 focus:not-hover:bg-on-tertiary-container/10 ' +
    'active:bg-on-tertiary-container/10',
};

/**
 * State-layer classes for a selected row, mixed over the row's own container colour.
 *
 * @remarks
 * A state layer is the "on" role laid over the component's container, so on a selected row it
 * has to mix into `tertiary-container` (standard) or `tertiary` (vibrant) rather than into the
 * menu surface underneath. An alpha fill would let the menu background show through the
 * selection instead, which is a different colour from the one the spec names.
 */
const SELECTED_STATE_LAYER: Readonly<Record<MenuVariant, string>> = {
  standard:
    'hover:bg-[color-mix(in_oklab,var(--on-tertiary-container)_8%,var(--tertiary-container))] ' +
    'focus:not-hover:bg-[color-mix(in_oklab,var(--on-tertiary-container)_10%,var(--tertiary-container))] ' +
    'active:bg-[color-mix(in_oklab,var(--on-tertiary-container)_10%,var(--tertiary-container))]',
  vibrant:
    'hover:bg-[color-mix(in_oklab,var(--on-tertiary)_8%,var(--tertiary))] ' +
    'focus:not-hover:bg-[color-mix(in_oklab,var(--on-tertiary)_10%,var(--tertiary))] ' +
    'active:bg-[color-mix(in_oklab,var(--on-tertiary)_10%,var(--tertiary))]',
};

/**
 * Icon colour roles for an unselected row.
 *
 * @remarks
 * Both the leading and the trailing icon take `on-surface-variant` in the standard mapping, a
 * step quieter than the label. Vibrant is the only mapping where icons move on interaction:
 * they shift from `on-tertiary-container` to `tertiary` on hover, focus, and press while the
 * label holds still.
 */
const ICON_ROLE: Readonly<Record<MenuVariant, string>> = {
  standard: '[&_svg]:text-on-surface-variant',
  vibrant:
    '[&_svg]:text-on-tertiary-container hover:[&_svg]:text-tertiary ' +
    'focus:[&_svg]:text-tertiary active:[&_svg]:text-tertiary',
};

/** Options accepted by {@link menuItemClass}. */
export interface MenuItemClassOptions {
  /** Render the row in its selected state — the spec's `menu-item.selected.*` tokens. */
  selected?: boolean;
}

/**
 * Full class string for an interactive menu row.
 *
 * @param variant - Which colour mapping to render in.
 * @param options - Pass `{ selected: true }` for the selected row.
 * @returns The row's complete geometry, colour, icon, and state-layer class string.
 *
 * @remarks
 * A selected row also changes shape: `menu-item.selected.shape` is `corner.medium` (12dp),
 * against `corner.extra-small` (4dp) for an unselected one. The size of the box does not move —
 * only its corners and its colour — so this stays inside the design system's rule that
 * interaction never changes geometry.
 *
 * @example
 * ```tsx
 * <DropdownMenuPrimitive.Item className={cn(menuItemClass('standard', { selected }), menuFocusRing)} />
 * ```
 */
export function menuItemClass(variant: MenuVariant, options?: MenuItemClassOptions): string {
  const selected = options?.selected ?? false;

  if (!selected) {
    return cn(
      menuItemBase,
      ICON_ROLE[variant],
      STATE_LAYER[variant],
      {
        standard: 'text-on-surface',
        vibrant: 'text-on-tertiary-container',
      }[variant],
    );
  }

  return cn(
    menuItemBase,
    'rounded-corner-md',
    SELECTED_STATE_LAYER[variant],
    variant === 'vibrant'
      ? 'bg-tertiary text-on-tertiary [&_svg]:text-on-tertiary'
      : 'bg-tertiary-container text-on-tertiary-container [&_svg]:text-on-tertiary-container',
  );
}

/**
 * Selected-state classes keyed off Radix's `data-state="checked"`.
 *
 * @param variant - Which colour mapping to render in.
 * @returns The checked row's shape, container, content, and state-layer escalation.
 *
 * @remarks
 * {@link menuItemClass} takes selection as a boolean, which a checkbox row can supply but a
 * radio row cannot — Radix derives a radio item's checked state from its group's value and
 * publishes it only as an attribute. This builder is that same escalation expressed as
 * `data-[state=checked]:` variants so both row types resolve to one set of roles.
 *
 * The indicator gutter is deliberately not here: a checkable row still owes the spec its 16dp
 * leading space, and the indicator sits inside that.
 */
export function menuCheckedItemClass(variant: MenuVariant): string {
  if (variant === 'vibrant') {
    return cn(
      'data-[state=checked]:rounded-corner-md',
      'data-[state=checked]:bg-tertiary data-[state=checked]:text-on-tertiary',
      'data-[state=checked]:[&_svg]:text-on-tertiary',
      'data-[state=checked]:hover:bg-[color-mix(in_oklab,var(--on-tertiary)_8%,var(--tertiary))]',
      'data-[state=checked]:focus:not-hover:bg-[color-mix(in_oklab,var(--on-tertiary)_10%,var(--tertiary))]',
    );
  }

  return cn(
    'data-[state=checked]:rounded-corner-md',
    'data-[state=checked]:bg-tertiary-container data-[state=checked]:text-on-tertiary-container',
    'data-[state=checked]:[&_svg]:text-on-tertiary-container',
    'data-[state=checked]:hover:bg-[color-mix(in_oklab,var(--on-tertiary-container)_8%,var(--tertiary-container))]',
    'data-[state=checked]:focus:not-hover:bg-[color-mix(in_oklab,var(--on-tertiary-container)_10%,var(--tertiary-container))]',
  );
}

/**
 * The leading gutter a checkable row reserves for its indicator, and the matching offset for a
 * plain row or label that has to share the same text axis.
 *
 * @remarks
 * 16dp leading space + 20dp icon + 12dp between-space = 48dp, so a checkbox row's label lands
 * on exactly the axis an icon row's label lands on. The old value was 32px against an 18px
 * icon, which is why `CORE-08` measured Display radio rows at 32px of leading padding and
 * Filter rows at 8px and called the column "not fixed".
 */
export const MENU_INDICATOR_GUTTER = 'pl-12' as const;

/**
 * The menu row's keyboard-focus indicator.
 *
 * @remarks
 * `md.sys.state.focus-indicator`: 3dp thick at a -3dp offset, drawn inside the row so it cannot
 * collide with the neighbour above. The colour is `md.sys.color.secondary`, which `--ring`
 * resolves to. This is why menu rows do not use the shared `focusRingInset` — that ring is 1px
 * and the spec's is 3dp.
 */
export const menuFocusRing =
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset' as const;

/**
 * Class string for a section label / group heading.
 *
 * @param variant - Which colour mapping to render in.
 * @returns Label colour on the row's own horizontal rhythm.
 *
 * @remarks
 * The spec gives `section-label-text.color` and no typography token for it, so the type role is
 * Docket's choice: `label-medium`, one step below the row label.
 */
export function menuLabel(variant: MenuVariant): string {
  return cn(
    'text-label-medium px-4 py-2',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}

/**
 * Class string for a group wrapper — the spec's "Grouped" layout configuration.
 *
 * @param variant - Which colour mapping to render in.
 * @returns The group's shape and padding.
 *
 * @remarks
 * `group.shape` is `corner.small` (8dp) and `group.padding` is 2dp, with a 2dp `gap` between
 * groups. A group is a shape, not a colour: it collects rows into one rounded block so a long
 * menu reads as sections without needing a rule between them. The rows inside keep their own
 * 4dp corners and the group's first and last rows still take the 12dp edge corner.
 */
export function menuGroup(_variant: MenuVariant): string {
  return 'rounded-corner-sm p-0.5 not-first:mt-0.5';
}

/**
 * Class string for a divider between groups.
 *
 * @param variant - Which colour mapping to render in.
 * @returns The separator's geometry and colour.
 *
 * @remarks
 * Neither expressive colour set defines a divider token — the anatomy names one and the colour
 * tables stop at 11 elements without it. `outline-variant` is the role the rest of the design
 * system uses for a hairline, and it is what the baseline menu's `divider.color`
 * (`surface-variant`) maps onto here. The 8dp of vertical space is the baseline spec's
 * `divider top/bottom padding`, which expressive does not restate.
 *
 * Inset within the container's own padding rather than bled edge to edge, so it reads as a rule
 * *between* rows rather than a seam across the container.
 */
export function menuSeparator(_variant: MenuVariant): string {
  return 'bg-outline-variant my-2 h-px';
}

/**
 * Class string for an optional badge — a compact trailing pill.
 *
 * @param variant - Which colour mapping to render in.
 * @returns Badge chrome plus this mapping's supporting-content role.
 *
 * @remarks
 * The anatomy names a badge; no expressive token set gives it a colour or a shape, so it
 * borrows the mapping's supporting-text role.
 */
export function menuBadge(variant: MenuVariant): string {
  return cn(
    'ml-auto inline-flex items-center rounded-full px-1.5 text-label-small tabular-nums',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}

/**
 * Class string for optional trailing text — a shortcut hint or a meta value.
 *
 * @param variant - Which colour mapping to render in.
 * @returns Trailing-text typography and colour.
 *
 * @remarks
 * `menu-item.trailing-supporting-text` is `label-large`, the same role as the row's own label —
 * not a smaller one. It is separated from the label by colour, not by size.
 */
export function menuTrailingText(variant: MenuVariant): string {
  return cn(
    'ml-auto text-label-large',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}

/**
 * Class string for optional supporting text — a quieter second line under the row label.
 *
 * @param variant - Which colour mapping to render in.
 * @returns Supporting-line typography and colour.
 */
export function menuSupporting(variant: MenuVariant): string {
  return cn(
    'text-body-small',
    variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface-variant',
  );
}
