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
 * It is exported from `@docket/ui` so a menu living outside `primitives/` can reach it;
 * `design-token-scan.ts` fails the build on a hand-rolled menu row.
 *
 * ## The spec these values come from
 *
 * Every number and colour role below is `md.comp.menus.*` from the M3 Expressive vertical menu,
 * transcribed in **`docs/design/references/md3-menus.md`** against a pinned source revision. Read
 * that file before changing anything here, and change it first if a value has to move.
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
 * without re-deriving it. A menu row is a spec'd component rather than a control, so it carries
 * its own metrics instead of taking a step from the shared `CONTROL` scale.
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
  sm: 'w-48 min-w-0',
  /** 224px — the default: an action list with icons and labels. */
  md: 'w-56 min-w-0',
  /** 288px — rows carrying supporting text or a trailing value. */
  lg: 'w-72 min-w-0',
  /** 352px — rows carrying a path, a timestamp, or a workspace name. */
  xl: 'w-88 min-w-0',
};

/** The default width when a menu does not ask for one. */
export const DEFAULT_MENU_WIDTH: MenuWidth = 'md';

/**
 * How a menu separates its sections. The spec offers exactly these two, and they are alternatives
 * rather than things to combine.
 *
 * @remarks
 * - `divider` — one filled container with a hairline rule between sections. The default, and what
 *   almost every menu in this product wants.
 * - `gap` — the "Vertical menu with gap" figure, also called the grouped layout. The container
 *   stops painting and **each section paints its own filled block**, so the surface behind the
 *   menu shows through between them. That backdrop is the effect, which is why the group and not
 *   the container has to own the fill.
 */
export type MenuSections = 'divider' | 'gap';

/** The default section treatment when a menu does not ask for one. */
export const DEFAULT_MENU_SECTIONS: MenuSections = 'divider';

/**
 * Structural classes for the floating menu surface, shared by both mappings.
 *
 * @remarks
 * Carries `container.shape` (`corner.large`, 16dp), the 4dp container padding,
 * `container.elevation` (`level2`), and the open/close motion.
 *
 * **Row rhythm.** `md.comp.menus.gap` is 2dp, and it sits between every row, not only between
 * sections — which is why a row has a corner radius at all. A flush list would not need one. The
 * rows are discrete 4dp pills stacked 2dp apart on the container fill, and the measurements
 * figure's 48dp row bracket is that: the 44dp `menu-item.height` plus 2dp of gap top and bottom.
 *
 * **Section gap — a deliberate deviation.** Between whole sections the gap is 4dp
 * (`md.sys.measurement.space50`) against the token's 2dp. Sampling the spec figure shows its seam
 * really is 2dp, and what makes it read there is the lower block's drop shadow darkening the page
 * behind it; `level2` here is lighter, so the gap takes the next measurement step up to stay
 * legible.
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
  'z-[120] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-corner-lg ' +
  'has-data-[state=open]:rounded-corner-sm transition-[border-radius] ' +
  'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ' +
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'duration-(--dur-base) ease-(--ease-out)';

/** The container's fill and content roles — what a grouped menu hands to its groups. */
const MENU_SURFACE: Readonly<Record<MenuVariant, string>> = {
  standard: 'bg-surface-container-low text-on-surface',
  vibrant: 'bg-tertiary-container text-on-tertiary-container',
};

/**
 * Cap a floating menu at the height Radix measured for it, and scroll inside that.
 *
 * @remarks
 * Without this a menu taller than the space below its trigger cannot scroll, so Radix's collision
 * handling does the only other thing available: it shifts the whole panel until it fits. A long
 * submenu then opens *level with the viewport* rather than level with the row that opened it —
 * a ten-item "Limit to a team" list rendering two hundred pixels above its own trigger, visually
 * detached from the menu it belongs to.
 *
 * `Content` already did this and `SubContent` did not, in both the dropdown and the context menu,
 * which is why only long submenus drifted. The values are keyed by menu because Radix namespaces
 * the custom property per primitive, and each is written as a literal string so Tailwind's scanner
 * still finds it.
 */
export const MENU_VIEWPORT_FIT = {
  dropdown:
    'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-x-hidden overflow-y-auto',
  context:
    'max-h-[var(--radix-context-menu-content-available-height)] overflow-x-hidden overflow-y-auto',
} as const;

/**
 * Full class string for the menu container surface.
 *
 * @param variant - Which colour mapping to render in.
 * @param width - One of the four {@link MENU_WIDTH} steps. Defaults to `md`.
 * @param sections - How sections separate. See {@link MenuSections}.
 * @returns The structural base plus this mapping's container and default content roles.
 *
 * @remarks
 * Under `sections: 'gap'` the container keeps its size, stacking, motion, and scroll behaviour and
 * hands its fill, padding, elevation, and clipping to {@link menuGroup}, once per section — a fill
 * spanning the whole menu is the thing a gap has to cut through.
 *
 * @example
 * ```tsx
 * <DropdownMenuPrimitive.Content className={cn(menuContentClass('standard'), MENU_OVERFLOW)} />
 * ```
 */
export function menuContentClass(
  variant: MenuVariant,
  width: MenuWidth = DEFAULT_MENU_WIDTH,
  sections: MenuSections = DEFAULT_MENU_SECTIONS,
): string {
  return cn(
    menuContentBase,
    MENU_WIDTH[width],
    sections === 'gap'
      ? // Colour still cascades to the rows; only the painted surface moves to the groups. The
        // flex gap here separates whole sections rather than rows, so it is the wider step.
        cn(
          'gap-1 bg-transparent',
          variant === 'vibrant' ? 'text-on-tertiary-container' : 'text-on-surface',
        )
      : cn(
          'gap-0.5 overflow-hidden p-1 shadow-level2',
          '[&>[role^=menuitem]:first-child]:rounded-t-corner-md',
          '[&>[role^=menuitem]:last-child]:rounded-b-corner-md',
          // A semantic group renders `display: contents`, so its rows lay out as the container's
          // own children — but a selector still has to walk through it, since `:first-child`
          // reads the DOM tree and not the layout tree.
          '[&>[role=group]:first-child>[role^=menuitem]:first-child]:rounded-t-corner-md',
          '[&>[role=group]:last-child>[role^=menuitem]:last-child]:rounded-b-corner-md',
          MENU_SURFACE[variant],
        ),
  );
}

/**
 * Structural classes for an interactive menu row, shared by both mappings.
 *
 * @remarks
 * `menu-item.shape` is `corner.extra-small` (4dp), and that is all a row sets for itself. The
 * 12dp `first-child`/`last-child` corner is applied by the *parent* — {@link menuContentClass}
 * under the divider layout, {@link menuGroup} under the gap one — because "am I on the menu's
 * outer edge?" is a question only the parent can answer. A row at the bottom of the first block
 * of a gapped menu is its block's last child and is not on the menu's edge at all; it keeps 4dp,
 * which is exactly the spec's `inner-corner.corner-size`.
 *
 * Disabled is `opacity-38`, not `opacity-50`: 0.38 is the literal every MD3 disabled token
 * carries.
 */
const menuItemBase =
  'relative flex min-h-11 cursor-default items-center gap-3 px-4 py-2 ' +
  'rounded-corner-xs ' +
  'text-label-large transition-colors outline-none select-none ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-38 ' +
  '[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0';

/**
 * State-layer classes for an unselected row.
 *
 * @remarks
 * Hover 8%, focus 10%, pressed 10%. Radix drives roving focus on pointer move, so a hovered row is
 * also a focused row; `focus:not-hover:` scopes the 10% layer to keyboard focus so a mouse hover
 * lands on the spec's 8%.
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
 * A state layer is the "on" role laid over the component's own container, so on a selected row it
 * mixes into `tertiary-container` (standard) or `tertiary` (vibrant). An alpha fill would let the
 * menu surface show through and land on a different colour than the spec names.
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
 * A selected row also changes shape: `menu-item.selected.shape` is `corner.medium` (12dp) against
 * `corner.extra-small` (4dp) unselected. Only the corners and the colour move, so this stays
 * inside the design system's rule that interaction never changes geometry.
 * The important modifier is required because the row keeps its base 4dp class. Tailwind emits
 * the custom corner utilities in an order that otherwise lets the base shape win at runtime.
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
    'rounded-corner-md!',
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
 * Radix derives a radio item's checked state from its group's value and publishes it only as an
 * attribute, so the escalation {@link menuItemClass} takes as a boolean is expressed here as
 * `data-[state=checked]:` variants. Both row types then resolve to one set of roles.
 */
export function menuCheckedItemClass(variant: MenuVariant): string {
  if (variant === 'vibrant') {
    return cn(
      'data-[state=checked]:rounded-corner-md!',
      'data-[state=checked]:bg-tertiary data-[state=checked]:text-on-tertiary',
      'data-[state=checked]:[&_svg]:text-on-tertiary',
      'data-[state=checked]:hover:bg-[color-mix(in_oklab,var(--on-tertiary)_8%,var(--tertiary))]',
      'data-[state=checked]:focus:not-hover:bg-[color-mix(in_oklab,var(--on-tertiary)_10%,var(--tertiary))]',
    );
  }

  return cn(
    'data-[state=checked]:rounded-corner-md!',
    'data-[state=checked]:bg-tertiary-container data-[state=checked]:text-on-tertiary-container',
    'data-[state=checked]:[&_svg]:text-on-tertiary-container',
    'data-[state=checked]:hover:bg-[color-mix(in_oklab,var(--on-tertiary-container)_8%,var(--tertiary-container))]',
    'data-[state=checked]:focus:not-hover:bg-[color-mix(in_oklab,var(--on-tertiary-container)_10%,var(--tertiary-container))]',
  );
}

/**
 * Class string for a row whose action destroys something.
 *
 * @remarks
 * `text-error focus:text-error` was hand-written at fifteen menu rows, and about half of them
 * omitted the `focus:` half — which is not cosmetic. A menu row sets its own label colour per
 * state, so a bare `text-error` is overridden the moment the row takes roving focus, and the
 * destructive tone vanishes for exactly the reader navigating by keyboard.
 *
 * The state layer moves to `error` too. Leaving it on `on-surface` gave a delete row the same
 * neutral wash as Rename, so the one row worth hesitating over highlighted like the rest.
 *
 * Only `standard` is offered. A vibrant menu is the high-emphasis tertiary mapping the spec says
 * to use sparingly, and there is no destructive action in the product on one.
 *
 * @returns the error role held across every state a menu row has.
 *
 * @example
 * ```tsx
 * <DropdownMenuItem className={menuDestructiveItem()} onSelect={onDelete}>
 * ```
 */
export function menuDestructiveItem(): string {
  return cn(
    'text-error focus:text-error hover:text-error',
    '[&_svg]:text-error',
    'hover:bg-error/8 focus:not-hover:bg-error/10 active:bg-error/10',
  );
}

/**
 * The leading gutter a checkable row reserves for its indicator, and the matching offset for a
 * plain row or label that has to share the same text axis.
 *
 * @remarks
 * 16dp leading space + 20dp icon + 12dp between-space = 48dp, so a checkbox row's label lands on
 * the same axis an icon row's label lands on.
 */
export const MENU_INDICATOR_GUTTER = 'pl-12' as const;

/**
 * The menu row's keyboard-focus indicator.
 *
 * @remarks
 * `md.sys.state.focus-indicator`: 3dp thick at a -3dp offset, drawn inside the row so it clears
 * the neighbour above. The colour is `md.sys.color.secondary`, which `--ring` resolves to.
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
 * Class string for a group — one painted section of a menu in the `gap` layout.
 *
 * @param variant - Which colour mapping to render in.
 * @param sections - The enclosing menu's section treatment. Under `divider` a group is a pure
 *   semantic wrapper and paints nothing, so the two treatments never stack.
 * @returns The group's surface, shape, padding, and row rhythm.
 *
 * **A divider menu's group is `display: contents`.** It still has to exist for screen readers,
 * but as a box it would eat the container's 2dp row gap and leave its rows flush against each
 * other. Removing it from the layout tree puts the rows back in the container's flex flow.
 *
 * @remarks
 * A group is a **surface**. It carries the fill, the 4dp inset, the elevation, and the clipping the
 * container gives up, which is what puts the backdrop in the gap between two sections.
 *
 * **Corners differ by edge.** `group.shape` (`corner.small`, 8dp) faces a gap; `container.shape`
 * (`corner.large`, 16dp) faces the menu's outer boundary, which the measurements figure marks 16 at
 * the top and 8 at the seam. The tighter radius at the seam is what makes two blocks read as one
 * menu that has been cut. A single group is both first and last, so it renders as a 16dp menu.
 *
 * The row corners fall out of that arithmetic: 16dp less the 4dp inset is the 12dp
 * `menu-item.first-child.shape` the outermost rows take, and 8dp less the same inset is 4dp — a
 * seam row's own `menu-item.shape`. The edge corner is therefore set here rather than on the row,
 * since "am I on the menu's outer edge?" depends on which block a row is in.
 */
export function menuGroup(variant: MenuVariant, sections: MenuSections = 'gap'): string {
  if (sections === 'divider') return 'contents';
  return cn(
    'flex flex-col gap-0.5 overflow-hidden p-1 shadow-level2',
    'rounded-corner-sm first:rounded-t-corner-lg last:rounded-b-corner-lg',
    'first:[&>[role^=menuitem]:first-child]:rounded-t-corner-md',
    'last:[&>[role^=menuitem]:last-child]:rounded-b-corner-md',
    MENU_SURFACE[variant],
  );
}

/**
 * Class string for a divider between groups.
 *
 * @param variant - Which colour mapping to render in.
 * @returns The separator's geometry and colour.
 *
 * @remarks
 * Neither expressive colour set defines a divider token — the anatomy names one and the colour
 * tables stop at 11 elements without it — so the role comes from the Divider component instead:
 * `md.comp.divider.color` is `outline-variant` at `md.comp.divider.thickness` 1dp. (The baseline
 * menu's `surface-variant` is the legacy value and is not what this uses.)
 *
 * **Vibrant does not take `outline-variant`.** That role is drawn from the neutral-variant
 * palette, and the Divider component assumes it sits on a neutral surface; on `tertiary-container`
 * it is a grey hairline that belongs to no tonal family and, in dark, barely resolves at all. With
 * no published token to defer to, the divider there is the surface's own `on-tertiary-container`
 * held back to a hairline's weight — the same role every other mark on a vibrant menu uses.
 *
 * The 8dp of vertical space is the baseline spec's `divider top/bottom padding`, which expressive
 * does not restate. Inset within the container's own padding rather than bled edge to edge, so it
 * reads as a rule *between* rows rather than a seam across the container.
 */
export function menuSeparator(variant: MenuVariant): string {
  // 6px here plus the container's own 2dp row gap is the baseline spec's 8dp of divider padding.
  return cn(
    'my-1.5 h-px',
    variant === 'vibrant' ? 'bg-on-tertiary-container/20' : 'bg-outline-variant',
  );
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
