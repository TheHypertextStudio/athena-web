# MD3 text fields — the token values Docket implements against

**Reader**: anyone changing `packages/ui/src/primitives/field.tsx`. When you finish, the
implementation and this file agree, or you have changed this file and said why.

**Source**: `material-components/material-web@main`,
`tokens/versions/v0_192/_md-comp-filled-text-field.scss` and `_md-comp-outlined-text-field.scss`,
fetched raw and read directly. The unversioned `tokens/_md-comp-*-text-field.scss` files forward to
these, and `v0_192` is one of only two sets in that folder (the other is `latest`).

|            |                                                                     |
| ---------- | ------------------------------------------------------------------- |
| Extracted  | 2026-09-11                                                          |
| Token sets | `md-comp-filled-text-field`, `md-comp-outlined-text-field` (v0_192) |

`field.tsx` used to cite these paths without recording the values, which is how the resting outline
drifted onto `outline-variant` — a role the spec never names for a field.

## These are not confirmed to be M3 Expressive

Say what this is: the Material Web token set. The package is actively maintained (v2.5.0, July
2026), but nothing in it declares an Expressive revision, and Expressive is a later pass over the
system than the `v0_192` set these values come from.

`md3-menus.md` distinguishes `Menus - Common` (Expressive) from `Menu (baseline)` and records the
baseline as legacy. It got that distinction by reading the token feed behind
`m3.material.io/components/…/specs` — `/_dsm/data/dsdb-m3/<build>/TOKEN_TABLE.<hash>.json`. That
feed is the only place seen so far that separates the two, and it was not reachable when this file
was written: the spec page is a client-rendered app, and the feed URL needs a build id and hash.

So treat the tables below as **MD3, unversioned as to Expressive**. If the Expressive feed says
something different — shape is the likeliest to have moved, since Expressive reworked the shape
scale — that wins, and this file gets corrected first.

## Outlined

| Token                 | Value                      |
| --------------------- | -------------------------- |
| `container-shape`     | `corner-extra-small` (4dp) |
| container fill        | **no token — transparent** |
| `outline-color`       | `outline`                  |
| `outline-width`       | 1px                        |
| `hover-outline-color` | `on-surface`               |
| `hover-outline-width` | 1px                        |
| `focus-outline-color` | `primary`                  |
| `focus-outline-width` | 2px                        |

## Filled

| Token                           | Value                                             |
| ------------------------------- | ------------------------------------------------- |
| `container-color`               | `surface-container-highest`                       |
| `container-shape`               | `corner-extra-small-top` (4dp top, square bottom) |
| `active-indicator-color`        | `on-surface-variant`                              |
| `active-indicator-height`       | 1px                                               |
| `hover-active-indicator-color`  | `on-surface`                                      |
| `hover-active-indicator-height` | 1px                                               |
| `focus-active-indicator-color`  | `primary`                                         |
| `focus-active-indicator-height` | 2px (v0_192); the unversioned file hardcodes 3px  |

A filled field has **no outline**. The container and the activation indicator identify it, which is
why the fill alone measuring 1.07:1 against a `surface-container-high` panel is not the whole story
— the indicator is the mark that carries.

## Where Docket differs, and why

| Value           | Spec                                    | Docket                                             | Why                                                                                                           |
| --------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Corner radius   | 4dp (`corner-extra-small`)              | 8px (`CONTROL_RADIUS`)                             | A field matches the buttons and chips beside it. See `control.tsx`.                                           |
| Filled shape    | `corner-extra-small-top`, square bottom | 8px on all four corners                            | Same reason. A square-bottomed field next to an 8px button is the inconsistency this scale exists to prevent. |
| Focus treatment | 2px `primary` outline / indicator       | `focusRing` (`ring-2 ring-ring`, i.e. `secondary`) | One focus vocabulary across every control. Two would be worse than a wrong role.                              |

Those three are deliberate and predate this file. Everything else tracks the tables above.
