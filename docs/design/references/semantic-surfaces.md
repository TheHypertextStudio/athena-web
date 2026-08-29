# Semantic surface roles

This reference is for Docket contributors who add or change a resting region. Choose one role
below before writing a component. Do not choose a tonal utility at a product call site.

| Role        | Token                       | Owner and use                                                             |
| ----------- | --------------------------- | ------------------------------------------------------------------------- |
| `canvas`    | `surface-container`         | App shell backdrop and full-bleed workspace frame.                        |
| `page`      | `surface`                   | Primary route content.                                                    |
| `well`      | `surface-container-lowest`  | Regions below a page, such as code or drop wells.                         |
| `card`      | `surface-container-low`     | Cards and inset furniture that sit one step from a page.                  |
| `floating`  | `surface-container-high`    | Dialogs, sheets, banners, panel popovers, and hover cards.                |
| `prominent` | `surface-container-highest` | Tooltips and transient surfaces that must clear another floating surface. |

The token order stays semantic in both themes. Light theme containers become darker as a region
recedes from `page`. Dark theme containers become lighter for the same relationship. Components
must therefore select the role and let the token set the actual colour. A raw tonal class hardcodes
the light-theme reading and produces the inconsistent dark surfaces this contract replaces.

MD3 standard menus retain their specified `surface-container-low` through the menu primitive. A
form or catalog popover uses `floating`. A menu-shaped popover uses the menu primitive. Selected
rows use a state or selection role. They do not create a second resting-surface role. Scrims use
`scrim`, never black.

`Surface` owns the role, shape, and inset for structural regions. `Card`, hover cards, and tooltips
select their documented roles through their own primitives. Callers may add layout and state-layer
classes. They may not redefine a resting surface with a raw background utility.
