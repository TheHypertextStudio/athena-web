# MD3 menus — the token values Docket implements against

**Reader**: anyone changing `packages/ui/src/primitives/menu-styles.ts` or a surface that renders
a menu. When you finish, the implementation and this file agree, or you have changed this file
and said why.

**Source**: https://m3.material.io/components/menus/specs. The page renders its token tables from
`/_dsm/data/dsdb-m3/<build>/TOKEN_TABLE.<hash>.json`, and the values below were read out of that
feed rather than off the rendered page or a screenshot.

|                 |                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------ |
| Design system   | `designSystems/20543ce18892f7d9` — Google Material 3                                       |
| System revision | `7989`, created 2026-05-27                                                                 |
| Feed build      | `2026-07-30_05-30-21`                                                                      |
| Extracted       | 2026-08-05                                                                                 |
| Token sets      | `Menus - Common`, `Menus - Color - Standard`, `Menus - Color - Vibrant`, `Menu (baseline)` |

Docket implements the **M3 Expressive vertical menu** — the `Menus - Common` set plus one of the
two colour sets. The `Menu (baseline)` set is recorded at the end for reference only; M3
documents it as legacy and Docket does not build against it.

## Why this file exists

`menu-styles.ts` used to cite `tokens/_md-comp-menu.scss` and
`tokens/versions/v0_192/_md-comp-list.scss`. Those are the **baseline** menu's tokens. Nobody
could re-check a path that does not exist in this repo, so the implementation drifted from the
current spec on container shape, row height, icon size, typography, and the selection colour role
without anyone noticing. Every value below is therefore written down with the token name that
produced it.

## Resolved system values

The component tokens alias these. Listed once so the tables below stay readable.

| System token                                | Value                                      |
| ------------------------------------------- | ------------------------------------------ |
| `md.sys.shape.corner.extra-small`           | 4dp, rounded                               |
| `md.sys.shape.corner.small`                 | 8dp, rounded                               |
| `md.sys.shape.corner.medium`                | 12dp, rounded                              |
| `md.sys.shape.corner.large`                 | 16dp, rounded                              |
| `md.sys.shape.corner.full`                  | circular                                   |
| `md.sys.elevation.level2`                   | 3dp                                        |
| `md.sys.measurement.space25`                | 2dp                                        |
| `md.sys.measurement.space50`                | 4dp                                        |
| `md.sys.measurement.space75`                | 6dp                                        |
| `md.sys.measurement.space100`               | 8dp                                        |
| `md.sys.measurement.space150`               | 12dp                                       |
| `md.sys.measurement.space200`               | 16dp                                       |
| `md.sys.typescale.label-large`              | 14sp / 20 line / weight 500 / tracking 0.1 |
| `md.sys.typescale.body-small`               | 12sp / 16 line / weight 400 / tracking 0.4 |
| `md.sys.state.hover.state-layer-opacity`    | 0.08                                       |
| `md.sys.state.focus.state-layer-opacity`    | 0.10                                       |
| `md.sys.state.pressed.state-layer-opacity`  | 0.10                                       |
| `md.sys.state.focus-indicator.thickness`    | 3dp                                        |
| `md.sys.state.focus-indicator.inner-offset` | -3dp                                       |

Disabled opacity is 0.38. It is not a system token — each disabled component token carries the
literal, e.g. `md.comp.menus.menu-item.disabled.label-text.opacity = 0.38`.

## Menus — Common

### Shape

| Token                                            | Value                      |
| ------------------------------------------------ | -------------------------- |
| `container.shape`                                | `corner.large` — 16dp      |
| `active.container.shape`                         | `corner.large` — 16dp      |
| `inactive.container.shape`                       | `corner.small` — 8dp       |
| `menu-item.shape`                                | `corner.extra-small` — 4dp |
| `menu-item.selected.shape`                       | `corner.medium` — 12dp     |
| `menu-item.first-child.shape`                    | `corner.medium` — 12dp     |
| `menu-item.first-child.inner-corner.corner-size` | `corner.extra-small` — 4dp |
| `menu-item.last-child.shape`                     | `corner.medium` — 12dp     |
| `menu-item.last-child.inner-corner.corner-size`  | `corner.extra-small` — 4dp |
| `group.shape`                                    | `corner.small` — 8dp       |

`active` and `inactive` are the submenu states: the menu holding keyboard focus is active at
16dp, and a parent menu that has revealed a submenu drops to 8dp. That shape change is the
expressive active state, not decoration.

The first and last rows take a 12dp corner on the side facing the container edge and keep the
4dp `menu-item.shape` on the side facing their neighbour — that is what `inner-corner` means.
Container padding is **4dp**: 16dp container minus 4dp padding leaves the 12dp outer corner the
tokens specify for the first and last rows.

### Layout

| Token                          | Value             |
| ------------------------------ | ----------------- |
| `menu-item.height`             | 44dp              |
| `menu-item.leading-space`      | `space200` — 16dp |
| `menu-item.trailing-space`     | `space200` — 16dp |
| `menu-item.top-space`          | `space100` — 8dp  |
| `menu-item.bottom-space`       | `space100` — 8dp  |
| `menu-item.between-space`      | `space150` — 12dp |
| `menu-item.leading-icon.size`  | 20dp              |
| `menu-item.trailing-icon.size` | 20dp              |
| `gap`                          | `space25` — 2dp   |
| `group.padding`                | `space25` — 2dp   |
| `container.elevation`          | `level2` — 3dp    |

`between-space` is the gap between elements inside a row — leading icon to label, label to
trailing content.

`gap` (2dp) sits between **every row**, not only between sections. That is what gives a row a
corner radius at all: the rows are discrete 4dp pills stacked 2dp apart on the container fill, not
a flush list. The measurements figure brackets a row at 48dp, which is `menu-item.height` (44dp)
plus that 2dp above and below.

### Sections: gap or divider

A vertical menu separates its sections one of two ways, and they are alternatives:

| Treatment | What renders                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Divider   | One filled container, with a 1dp rule between sections.                                                                                         |
| Gap       | The container stops painting; **each section paints its own filled block**, and the surface behind the menu shows through the gap between them. |

The gap treatment is the part most easily got wrong. The 2dp gap only reads because the blocks
either side of it are filled — a transparent wrapper with a 2dp margin, sitting inside a container
that is already one solid block, renders nothing whatsoever. Under this layout the group takes the
container's fill, padding, elevation, and clipping; the container keeps only its size, stacking,
motion, and scrolling.

**Section gap.** Between whole sections Docket uses 4dp (`space50`), not the 2dp
`md.comp.menus.gap` gives. Sampling the spec figure pixel by pixel shows its seam really is 2dp;
what makes it read there is the lower block's drop shadow darkening the page behind it, and
Docket's `level2` is lighter, so 2dp of bare backdrop disappears. The gap is the entire point of
this layout, so it takes the next measurement step rather than being correct and invisible. Rows
inside a section keep the 2dp token.

**Group corners are not uniform.** A group is `group.shape` (`corner.small`, 8dp) on the edges
facing a gap and `container.shape` (`corner.large`, 16dp) where it is the menu's own outer
boundary. The figure marks 16 at the top of the menu and 8 at the seam, and the difference carries
meaning: a tighter radius at the seam is what makes two blocks read as one menu that has been cut,
rather than as two menus that happen to be stacked. A single group is both first and last, so it
renders as an ordinary 16dp menu.

The 12dp `menu-item.first-child.shape` follows from that arithmetic rather than being set on the
row: 16dp outer less the 4dp inset is 12dp, and 8dp at a seam less the same inset is 4dp — the
row's own `menu-item.shape`, which is why a row at a seam needs no override. The edge corner is
applied by whichever element owns the padded surface, not by the row, because "am I on the menu's
outer edge?" is not a question a row can answer: a row at a seam is its block's last child and is
not on the edge.

**Group padding.** A group carries the same 4dp inset the container does — a group is the
container's surface repeated per section, and the gap is the only difference between the two
layouts.

### Typography

| Element                              | Type role     |
| ------------------------------------ | ------------- |
| `menu-item.label-text`               | `label-large` |
| `menu-item.supporting-text`          | `body-small`  |
| `menu-item.trailing-supporting-text` | `label-large` |

Trailing supporting text is `label-large`, the same role as the label — not a smaller one.

### Focus ring

| Token                                      | Value                    |
| ------------------------------------------ | ------------------------ |
| `menu-item.focus.indicator.color`          | `md.sys.color.secondary` |
| `menu-item.focus.indicator.thickness`      | 3dp                      |
| `menu-item.focus.indicator.outline.offset` | -3dp (inset)             |

## Menus — Color — Standard

Surface-based. The default mapping; almost every menu uses it.

| Element                  | Enabled                 | Hovered              | Focused              | Pressed              |
| ------------------------ | ----------------------- | -------------------- | -------------------- | -------------------- |
| container                | `surface-container-low` | —                    | —                    | —                    |
| menu item container      | `surface-container-low` | —                    | —                    | —                    |
| label text               | `on-surface`            | `on-surface`         | `on-surface`         | `on-surface`         |
| leading icon             | `on-surface-variant`    | `on-surface-variant` | `on-surface-variant` | `on-surface-variant` |
| trailing icon            | `on-surface-variant`    | `on-surface-variant` | `on-surface-variant` | `on-surface-variant` |
| supporting text          | `on-surface-variant`    | —                    | —                    | —                    |
| trailing supporting text | `on-surface-variant`    | —                    | —                    | —                    |
| section label text       | `on-surface-variant`    | —                    | —                    | —                    |
| state layer              | —                       | `on-surface` @ 0.08  | `on-surface` @ 0.10  | `on-surface` @ 0.10  |

Selected rows:

| Element                                    | Enabled                 | Hovered                        | Focused                        | Pressed                        |
| ------------------------------------------ | ----------------------- | ------------------------------ | ------------------------------ | ------------------------------ |
| container                                  | `tertiary-container`    | —                              | —                              | —                              |
| label / icons / supporting / trailing text | `on-tertiary-container` | `on-tertiary-container`        | `on-tertiary-container`        | `on-tertiary-container`        |
| state layer                                | —                       | `on-tertiary-container` @ 0.08 | `on-tertiary-container` @ 0.10 | `on-tertiary-container` @ 0.10 |

Active (the row whose submenu is open): state layer `on-surface` @ 0.08.

Disabled: content keeps its enabled colour and drops to opacity 0.38. A disabled **selected**
row also drops its `tertiary-container` background to opacity 0.

Container shadow colour: `md.sys.color.shadow`.

## Menus — Color — Vibrant

Tertiary-based, higher emphasis. The spec says to use it sparingly.

| Element                  | Enabled                 | Hovered                        | Focused                        | Pressed                        |
| ------------------------ | ----------------------- | ------------------------------ | ------------------------------ | ------------------------------ |
| container                | `tertiary-container`    | —                              | —                              | —                              |
| menu item                | `tertiary-container`    | —                              | —                              | —                              |
| label text               | `on-tertiary-container` | `on-tertiary-container`        | `on-tertiary-container`        | `on-tertiary-container`        |
| leading icon             | `on-tertiary-container` | **`tertiary`**                 | **`tertiary`**                 | **`tertiary`**                 |
| trailing icon            | `on-tertiary-container` | **`tertiary`**                 | **`tertiary`**                 | **`tertiary`**                 |
| supporting text          | `on-tertiary-container` | `on-tertiary-container`        | `on-tertiary-container`        | `on-tertiary-container`        |
| trailing supporting text | `on-tertiary-container` | `on-tertiary-container`        | `on-tertiary-container`        | `on-tertiary-container`        |
| section label text       | `on-tertiary-container` | —                              | —                              | —                              |
| state layer              | —                       | `on-tertiary-container` @ 0.08 | `on-tertiary-container` @ 0.10 | `on-tertiary-container` @ 0.10 |

Vibrant is the only mapping where the icons change colour on interaction: they shift from
`on-tertiary-container` to `tertiary` on hover, focus, and press, while the label does not move.

Selected rows:

| Element                                    | Enabled       | Hovered              | Focused              | Pressed              |
| ------------------------------------------ | ------------- | -------------------- | -------------------- | -------------------- |
| container                                  | `tertiary`    | —                    | —                    | —                    |
| label / icons / supporting / trailing text | `on-tertiary` | `on-tertiary`        | `on-tertiary`        | `on-tertiary`        |
| state layer                                | —             | `on-tertiary` @ 0.08 | `on-tertiary` @ 0.10 | `on-tertiary` @ 0.10 |

Active: state layer `on-tertiary-container` @ 0.08. Disabled: opacity 0.38.

## Known gaps in the spec itself

**Divider colour.** The anatomy diagram lists an optional divider, and the measurements figure
shows one, but neither expressive colour set defines a divider token. The role therefore comes from
the Divider component: `md.comp.divider.color` is `outline-variant` at `md.comp.divider.thickness`
1dp. (`Menu (baseline)` gives `surface-variant`; that is the legacy value and Docket does not use
it.)

Vibrant is the exception. `outline-variant` is drawn from the neutral-variant palette and the
Divider component assumes a neutral surface, so on `tertiary-container` it is a grey hairline that
belongs to no tonal family and barely resolves in dark. With no published token to defer to, the
vibrant divider is `on-tertiary-container` at 20% — the surface's own "on" role, held to a
hairline's weight, which is what every other mark on a vibrant menu uses.

**Badge.** The anatomy names an optional badge; no expressive token set defines its colour or
shape. Docket tints it with the mapping's supporting-text role.

**Container width.** The expressive set defines no min or max width. The baseline set gives
112dp min / 280dp max, which is phone scale.

**Motion.** The spec describes submenu shape morphing but publishes no duration or easing token
for it. Docket uses `--dur-base` / `--ease-out`, the same pair the menu's open and close
animation already uses.

## Menu (baseline) — deprecated, do not build against it

Docket does not implement the baseline menu and no surface may reintroduce it. It is M3's legacy
variant: square 4dp corners, 48dp rows, 24dp icons, and `secondary-container` for selection. The
last of those is the one that matters, because it is the value this codebase had silently drifted
onto — a reader who finds a stray `secondary-container` on a menu row is looking at the baseline
spec, not at a design decision.

The full baseline token set is one click away in the spec if anyone ever needs to decode an old
screenshot. It is deliberately not transcribed here: a table in this file reads as an option, and
this is not one.
