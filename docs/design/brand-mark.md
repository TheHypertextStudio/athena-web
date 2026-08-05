# The Docket mark

For anyone changing the app icon, or deciding whether Docket needs a real one. Read this before
editing any icon asset: they are all generated, and hand-editing one puts it back the way it was.

## What it is

Three vertical stadium bars — tall, short, medium — in `#FAFAFA` on a `#1C1C1F` rounded plate. The
bars are not drawn by us. They are the three bar subpaths of **Material Symbols `view_kanban`**,
shipped as `@mui/icons-material/ViewKanbanRounded` and already a dependency of this repository.
Material Symbols are Apache-2.0.

`packages/brand/src/mark.ts` is the only file in the repository that knows this. Everything else —
the favicon, the PWA icon set, the Apple layer, the copy inlined into the offline page — is
generated from it by `pnpm icons`.

## Why an off-the-shelf glyph

The mark this replaced was three hand-typed `<rect>` elements added in commit `260b784f`, whose
actual purpose was fixing a favicon 404. The only rationale ever recorded was the phrase "a small
board mark." Nothing explained why three bars, why their 16/10/13 heights, or why they were
top-aligned — and top-aligned solid bars with the middle one shortest read as a bar chart, not a
board.

Taking Google's glyph fixes the part that was actually broken. The proportions are drawn by people
who draw icons, they are tested at small sizes, and the file states its own provenance. What it
does not fix: **a stock icon cannot be a distinctive trademark.** Docket has the same mark as any
other product that reached for `view_kanban`. This is a waypoint. If Docket ever wants a
defensible mark, that is a separate piece of work and it starts from a brief, not from an icon set.

## The two constants

Both are derived. Neither was nudged until it looked right.

| Constant    | Value | Where it comes from                                                                                                                                                                                                                   |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COVERAGE`  | 0.69  | The fraction of the canvas the mark's longer dimension spans. The outgoing mark covered 47%, which left it floating in a mostly empty tile.                                                                                           |
| `GAP_RATIO` | 0.5   | Gap between bars as a fraction of bar width. Material draws 1.0, which reads as three separate strokes. 0.5 is the floor: at a 16px favicon it works out to ~1.1 device pixels, and below one pixel the bars merge into a grey smear. |

The bars are taller than they are wide (aspect 0.8), so `COVERAGE` governs the height and the
width follows. Scaling both axes to 69% independently would distort a glyph whose proportions are
not ours to change.

`packages/brand/tests/mark.test.ts` asserts the one-pixel floor directly, so lowering `GAP_RATIO`
for "more cohesion" fails the suite rather than quietly breaking the favicon.

## Why the Apple canvas differs

The web mark sits on a plate it draws itself and needs margin inside it. The Apple mark sits on a
grid whose mask Apple applies, and its usable area is the largest centred square inside that mask
— measured at 869px of the 1024px canvas. `APPLE_COVERAGE` is `800/1024`, which puts the mark's
height at 92% of that live area.

800px is exactly what the previous asset used. Holding it constant kept this change about the
glyph rather than about the size, and preserved the mask clearance
`apps/web/tests/pwa/apple-icons.test.ts` enforces.

That test's width bound is looser than its height bound (0.7 against 0.9) because the glyph's
aspect is 0.8: a mark that fills the height cannot also fill the width. The stronger assertion
sitting next to it is that the Apple layer's aspect ratio matches the web mark's exactly — the two
are the same shape scaled, not the two independently-drawn variants they used to be.

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

## The Apple appearances

`ictool` renders six: `Default`, `Dark`, `TintedLight`, `TintedDark`, `ClearLight`, `ClearDark`.
All six are exported to `apps/web/design/exports/` as 1024px masters.

**Only `Default` is served.** Safari hands a home-screen web clip exactly one `apple-touch-icon`.
The other five exist to be reviewed and as groundwork for a native target; nothing displays them
today.

They are currently **auto-derived** by Icon Composer from the single `Default` fill, not authored.
The `Dark` rendition loses the plate gradient and flattens to a solid dark grey, and the tinted
pair falls back to `ictool`'s default tint rather than a monochrome layer the OS can tint. Giving
each appearance its own fill has to happen in Icon Composer.app — `docs/engineering/launch-compliance.json`
CAL-38 requires Apple's own tool, so hand-editing `icon.json` is not an option.

## Regenerating

```bash
pnpm icons
```

Runs, in order: the favicon and the offline page's inline copy, the PWA set, the Apple layer, and
the `ictool` export. The last step needs a Mac with Xcode 26; it refuses to run rather than
falling back to an approximation of an Apple render.

Changing the mark means changing `mark.ts` and re-running that. Editing `icon.svg`,
`Assets/Bars.svg`, `public/icons/*` or the offline page directly is undone by the next run, and
`packages/brand/tests/offline-page.test.ts` fails in the meantime.
