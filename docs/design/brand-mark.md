# The Docket mark

For anyone changing the app icon, or deciding whether Docket needs a real one. Read this before
editing any icon asset: they are all generated, and hand-editing one puts it back the way it was.

## What it is

Three vertical stadium bars — tall, short, medium — on a rounded plate. The first two are `#FAFAFA`;
the third is `#265ADF`, the `--primary` design token converted from OKLCH. The plate is `#1C1C1F`,
and it disappears in dark mode.

`packages/brand/src/mark.ts` is the only file in the repository that knows any of this. The
favicon, the PWA icon set, the Apple Icon Composer layer and the copy inlined into the offline page
are all generated from it by `pnpm icons`.

## Concentric corners

This is the constraint everything else is solved from.

Two rounded shapes nest correctly when their corner arcs **share a centre**, not when their radii
match. The plate's top-left arc is centred at `(R, R)`. The left bar's top cap is a semicircle of
radius `r = barWidth / 2`, centred at `(margin + r, margin + r)`. Setting those equal gives:

```
R = margin + r
```

That single equation has two consequences worth stating, because both look like arbitrary design
choices until you see where they come from.

**The mark's bounding box has to be square.** With different horizontal and vertical margins the
cap centre sits at `(margin_x + r, margin_y + r)`, which no single plate radius can meet on both
axes. So three bars plus two gaps must span exactly the tallest bar's height.

**The plate radius is derived, not fixed.** It was `rx="7"` from the day the mark was drawn, which
was concentric with nothing. It is now `margin + r` — 8.667 on a 32px canvas.

Squareness plus the 8:3 bar-to-gap ratio chosen in review fixes the rest by substitution:
`3w + 2(3w/8) = 1` gives `w = 4/15` and `g = 1/10`, exactly, and `3(4/15) + 2(1/10)` is exactly 1.

## The other derived numbers

| Constant         | Value              | Solved from                                                                                                                 |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `BAR_WIDTH`      | 4/15 of the mark   | Squareness plus the 8:3 ratio above                                                                                         |
| `BAR_GAP`        | 1/10 of the mark   | Same solution                                                                                                               |
| `BAR_HEIGHTS`    | 1 : 0.625 : 0.8125 | The 16/10/13 of the mark this replaced, which is where its balance came from                                                |
| `COVERAGE`       | 0.625              | `BAR_GAP × COVERAGE × 16 ≥ 1` at equality — the smallest mark whose gaps still clear one device pixel in a 16px browser tab |
| `APPLE_COVERAGE` | 800/1024           | The height the outgoing Apple asset used, so the redesign stayed about the bars rather than the size                        |
| `ACCENT`         | `#265ADF`          | `--primary`, `oklch(0.52 0.21 264)`, converted through Oklab                                                                |

The 8:3 ratio is the one number that came from looking rather than solving. Five candidate weights
were exported through `ictool` at 1024px and compared as real Liquid Glass renders; 200 wide with
75 of gap on the 800-unit grid won. The ceiling was the mask — at 260 wide the mark spans 910
units against a live area measured at 869, and the outer bars break clearance.

## Provenance, stated honestly

The redesign started from Material Symbols' `view_kanban` and for one commit quoted its path data
verbatim. That was rejected in review: Material's bars are 0.20 of the glyph height against the old
mark's 0.25, and under the Liquid Glass specular edge they read as long and thin.

What survives from Material is the **composition** — three bars, top-aligned, stadium ends, tall
then short then medium. Every proportion is Docket's. No upstream path data is quoted,
`@mui/icons-material` is not a dependency of `packages/brand`, and calling the mark "off the shelf"
would be false.

The mark is therefore Docket's own, which is worth knowing for the reason it is worth wanting: a
stock icon cannot be a distinctive trademark. This one can be, though nobody has filed anything.

## The accent

`--primary` is OKLCH and shifts between light and dark. An installed icon is a single fixed image
and cannot follow a token, so the light-mode value is baked in — it is the indigo that appears on
buttons, focus rings and selection. `--primary` in dark mode is a pale periwinkle that would read
as a tinted white bar rather than as a colour.

`packages/brand/src/color.ts` does the conversion (Oklab, then the sRGB transfer function, no
dependency), and the test re-reads `packages/ui/src/styles/globals.css` and re-derives it. Change
the token without re-running `pnpm icons` and the suite fails rather than the icon going quietly
off-brand.

## Theme adaptivity, and its limits

Only `icon.svg` adapts. It carries the plate as the default rule and drops it under
`@media (prefers-color-scheme: dark)`, so in a dark browser tab the bars read as a glyph on the tab
strip instead of a black tile with no edge.

The plate is the _default_ branch and its removal is the _override_, deliberately: Safari renders
SVG favicons but ignores their embedded media queries, so whichever branch is the default is the
one Safari shows.

| Surface                             | Adapts | Why                                                                                             |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Browser tab — Chrome, Firefox, Edge | Yes    | They re-evaluate `prefers-color-scheme` inside an SVG favicon and repaint on an OS theme change |
| Browser tab — Safari                | No     | Renders the file, ignores the media query; lands on the plated default                          |
| Offline page                        | Yes    | Same document, inlined                                                                          |
| Installed PWA, Android              | No     | Manifest icons are fixed images; the spec has no colour-scheme variants                         |
| iOS home screen web clip            | No     | Apple has never offered a dark or tinted appearance for a web clip                              |
| Apple native target                 | Would  | No native target exists in this repository                                                      |

Because the PWA icons must not inherit any of this, `render-pwa.ts` builds its own opaque document
rather than rasterizing `icon.svg`. Rasterizing the themed file would make a committed PNG depend
on how librsvg happens to treat a media query it cannot evaluate.

## Why the Apple canvas differs

The web mark sits on a plate this package draws and is bounded by the 16px favicon. The Apple mark
sits on a grid whose mask Apple applies, and its usable area is the largest centred square inside
that mask — measured at 869px of the 1024px canvas. At `800/1024` the mark is 800px square, 92% of
that live area on both axes.

**Concentricity is not defined against Apple's mask.** It is a continuous-curvature squircle, not a
rounded rectangle with a circular corner arc, so there is no radius to share a centre with. The
mark is square and centred, which is as far as the constraint carries onto a plate this package
does not draw.

## Why the bars are four arcs each, not two

Each stadium cap is two quarter arcs rather than one semicircle, so the topmost and bottommost
points are explicit coordinates.

A single semicircle puts them at the arc's extremum, where the sagitta is
`r − sqrt(r² − (chord/2)²)`. Rounding the radius and the chord to three decimals independently
leaves them a hair apart, the square root amplifies that hair, and a 0.001 rounding became a 0.05
error in the measured bounding box — which is how the geometry tests caught it.

## The Apple appearances

`ictool` renders six: `Default`, `Dark`, `TintedLight`, `TintedDark`, `ClearLight`, `ClearDark`.
All six are exported to `apps/web/design/exports/` as 1024px masters.

**Only `Default` is served.** Safari hands a home-screen web clip exactly one `apple-touch-icon`.
The other five exist to be reviewed and as groundwork for a native target; nothing displays them
today.

They are currently **auto-derived** by Icon Composer from the single `Default` fill, not authored.
The `Dark` rendition loses the plate gradient and flattens to a solid dark grey, and the tinted pair
falls back to `ictool`'s default tint rather than a monochrome layer the OS can drive. Giving each
appearance its own fill has to happen in Icon Composer.app — `docs/engineering/launch-compliance.json`
CAL-38 requires Apple's own tool, so hand-editing `icon.json` is not an option.

## Regenerating

```bash
pnpm icons
```

Runs, in order: the favicon and the offline page's inline copy, the PWA set, the Apple layer, and
the `ictool` export. The last step needs a Mac with Xcode 26; it refuses to run rather than falling
back to an approximation of an Apple render.

Changing the mark means changing `mark.ts` and re-running that. Editing `icon.svg`,
`Assets/Bars.svg`, `public/icons/*` or the offline page directly is undone by the next run, and
`packages/brand/tests/offline-page.test.ts` fails in the meantime.
