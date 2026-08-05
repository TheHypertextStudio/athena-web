/**
 * The Docket brand mark: three bars on a rounded plate, and the measured layout that places them.
 *
 * @remarks
 * This module is the only place in the repository that knows what the mark looks like. Every
 * asset — the browser favicon, the PWA icon set, the Apple Icon Composer layer, the glyph inlined
 * into the offline page — is rendered from {@link markPath}. Before this package existed the same
 * three bars were hand-typed into four files that drifted independently, and the web and Apple
 * copies had already diverged into two different compositions of the same idea.
 *
 * **Every number here is solved for, and the constraint it satisfies is written next to it.** The
 * governing one is corner concentricity: the plate's corner arc and the outer bars' cap arcs share
 * a centre. That single requirement fixes the mark's aspect ratio, the plate's radius, and the
 * relationship between bar width and gap. See {@link plateRadius}.
 *
 * @see {@link file://../../../docs/design/brand-mark.md} for the design rationale and its limits.
 */
import { svgPathBbox } from 'svg-path-bbox';

import { oklchToHex } from './color';

/**
 * Where the shape came from.
 *
 * @remarks
 * Recorded because the honest answer is not the one the first draft of this package gave. The mark
 * was rebuilt starting from Material Symbols' `view_kanban` — three top-aligned stadium bars in a
 * tall/short/medium rhythm — and for a while it quoted that glyph's path data verbatim. Design
 * review rejected the result: Material's bars are 0.2 of the glyph height, and against the plate
 * they read as long and thin rather than as a mark.
 *
 * What survives from Material is the **composition**: three bars, top-aligned, stadium ends, tall
 * then short then medium. Every proportion is Docket's, solved from the concentricity constraint
 * and from the bar weight chosen in review. No upstream path data is quoted, `@mui/icons-material`
 * is not a dependency of this package, and calling the mark "off the shelf" would be false.
 */
export const PROVENANCE = {
  /** The glyph the composition follows. */
  reference: 'Material Symbols view_kanban',
  /** What was taken from it. */
  taken: 'composition only — three top-aligned stadium bars, tall/short/medium',
  /** What was not. */
  notTaken: 'bar width, gap, heights, and corner radii; no path data is quoted',
} as const;

/** The bars, on every surface and at every size. */
export const INK = '#FAFAFA';

/**
 * The design token the plate is painted with.
 *
 * @remarks
 * Docket's tokens are OKLCH and shift between light and dark; an installed icon is a single fixed
 * image and cannot follow them. The light-mode value is the one that carries the brand — it is the
 * indigo on buttons, focus rings and selection — so that is the one baked in. `--primary` in dark
 * mode is a pale periwinkle that white bars would vanish against.
 *
 * @see {@link file://../../ui/src/styles/globals.css} — the declaration this must stay equal to.
 */
export const PLATE_TOKEN = { name: '--primary', scheme: 'light', oklch: 'oklch(0.52 0.21 264)' };

/**
 * The plate: `--primary`, converted from OKLCH.
 *
 * @remarks
 * Computed rather than pasted, and {@link file://../tests/mark.test.ts} re-reads the stylesheet and
 * re-derives it, so editing the token without regenerating the icons fails the suite instead of
 * leaving the mark quietly off-brand.
 *
 * The plate carried `#1C1C1F` until design review: an accent bar in `--primary` against near-black
 * reads muddy, and the Liquid Glass specular edge makes it worse. Putting the brand colour on the
 * plate instead of on one bar removes the pairing rather than tuning it, and lets all three bars
 * stay white — which is also what keeps them legible at 16px.
 */
export const PLATE = oklchToHex(0.52, 0.21, 264);

/**
 * The Apple plate's gradient, as sRGB triples in the form `icon.json` stores.
 *
 * @remarks
 * Icon Composer fills the plate with a vertical gradient rather than a flat colour, which is what
 * gives the glass something to refract. These are {@link PLATE_TOKEN} at OKLCH lightness 0.58 and
 * 0.44 — the same relative lift the outgoing near-black plate used, applied to the brand hue.
 */
export const APPLE_PLATE_GRADIENT = [
  [0.22745, 0.43922, 0.93333],
  [0.07843, 0.2588, 0.7451],
] as const;

/**
 * Bar heights, as fractions of the tallest bar.
 *
 * @remarks
 * The mark this replaced used `16 / 10 / 13`, which is where its balance came from. These are the
 * eleventh-grid values nearest to it — `0.636` and `0.818` against `0.625` and `0.8125`, a
 * difference under 2% and invisible at any size — chosen so every height lands on a whole unit.
 * See {@link BAR_WIDTH} for why elevenths.
 *
 * Material draws the middle bar at half the tall one; that stubbier version leaves a visible hole
 * under it and was rejected in review alongside the thin bars.
 */
export const BAR_HEIGHTS = [1, 7 / 11, 9 / 11] as const;

/**
 * Bar width, as a fraction of the mark's side.
 *
 * @remarks
 * Solved rather than picked. Two constraints fix it:
 *
 * 1. **The mark must be square.** Concentric corners require the same margin on all four sides,
 *    so the three bars plus two gaps must span exactly the tallest bar's height:
 *    `3w + 2g = 1`.
 * 2. **Every dimension lands on a whole unit.** Fractional widths are a smell in artwork that gets
 *    rasterized: an SVG that says 5.333 is one an exporter has to resolve, and it resolves it
 *    differently at different sizes. Elevenths are what make that possible here — the bar takes
 *    three of the eleven units the mark's side divides into and the gap takes one.
 *
 * `w = 3/11` and `g = 1/11` satisfy both: `3(3/11) + 2(1/11)` is exactly 1, and on a 32px canvas
 * the mark is 22 wide with 6px bars and 2px gaps, every number an integer. The same holds at 192,
 * 512 and on the 1024 Apple grid.
 *
 * The bar-to-gap ratio this lands on is 3:1. Design review picked 8:3 (2.67) from real `ictool`
 * renders; 3:1 is the nearest ratio on the integer grid and reads a touch tighter, which is the
 * direction review was already pushing.
 */
export const BAR_WIDTH = 3 / 11;

/**
 * Gap between bars, as a fraction of the mark's side.
 *
 * @remarks
 * The other half of the solution described on {@link BAR_WIDTH}: one of the eleven units the
 * mark's side divides into. Two pixels on a 32px canvas, 66 on the Apple grid.
 */
export const BAR_GAP = 1 / 11;

/**
 * The area centroid of the bars, as a fraction of the mark's side from its top edge.
 *
 * @remarks
 * Each bar is a rectangle of height `h` whose own centre is at `h / 2`, and whose area is
 * proportional to `h` since every bar is the same width. The stadium caps are ignored: each bar
 * has one at the top and one at the bottom, and they displace the same area in opposite
 * directions, so they cancel.
 *
 * @returns The centroid's vertical position, `0` at the top of the mark and `1` at the bottom.
 */
function centroidY(): number {
  const total = BAR_HEIGHTS.reduce((sum, height) => sum + height, 0);
  return BAR_HEIGHTS.reduce((sum, height) => sum + (height / 2) * height, 0) / total;
}

/**
 * How much of the centroid offset to actually correct.
 *
 * @remarks
 * About half, and roughly-half is the point. Correcting the full offset puts the centre of mass
 * exactly on the plate's centre and looks *worse* — the mark reads as sitting on the bottom,
 * because the eye takes the bars' shared top edge as an anchor and does not want the whole shift.
 * Correcting none of it leaves the mark hanging from the top, which is the complaint this started
 * from. The half came from comparing real `ictool` renders at 0%, 50% and 100% across two mark
 * sizes; it is the one judgement here made by looking rather than solving.
 *
 * The exact figure is then pinned to the integer grid: {@link OPTICAL_SHIFT} is `1/22` of the
 * mark's side, the nearest value that keeps the offset a whole unit on every canvas the mark is
 * drawn at. That works out to 0.587 of the centroid gap rather than 0.500 — inside the range the
 * renders were compared over, and worth more than the third decimal place of a judgement call.
 */
export const OPTICAL_CORRECTION = 1 / 22 / (0.5 - centroidY());

/**
 * How far down the mark sits from its bounding box's centre, as a fraction of the mark's side.
 *
 * @remarks
 * **Optical centring.** The bars are top-aligned with descending heights, so their ink is not
 * evenly distributed inside their bounding box: the area centroid sits at 0.4207 of the side
 * rather than 0.5. Centring the box therefore leaves the mark's visual mass 7.9% of its height
 * above the plate's centre — 63px on the 1024 grid — and the empty band under the two short bars
 * is what makes the icon read as hanging from the top. The rendered Apple asset is worse still,
 * because Icon Composer's specular highlight is top-weighted and its shadow falls downward.
 *
 * One unit of the mark's twenty-two, so the offset is a whole pixel on a 32px canvas and 33 on the
 * Apple grid. {@link OPTICAL_CORRECTION} reports what fraction of the centroid gap that closes, and
 * the test fails if the two stop agreeing to within the range the renders were judged over.
 *
 * **This is what trades away vertical concentricity.** With the mark shifted down, the top margin
 * no longer equals the side margins, and a single plate radius cannot share a centre with the cap
 * arcs on both axes — see {@link plateRadius}. The two are genuinely exclusive for a glyph whose
 * mass is not symmetric, and optical balance is the one a viewer perceives.
 */
export const OPTICAL_SHIFT = 1 / 22;

/** The smallest favicon the mark has to stay legible at. */
export const MIN_FAVICON = 16;

/**
 * Fraction of the web canvas the mark spans.
 *
 * @remarks
 * **Derived, not chosen.** Below one device pixel the gap between bars antialiases into a grey
 * smear and the mark reads as one blob, so the binding constraint is
 * `BAR_GAP * COVERAGE * MIN_FAVICON >= 1`. Solving it at equality gives 0.625: the smallest mark
 * that still resolves as three bars in a 16px browser tab, and therefore the largest plate margin
 * the mark can afford.
 *
 * {@link file://../tests/mark.test.ts} asserts the pixel floor directly, so changing
 * {@link BAR_GAP} without revisiting this fails the suite.
 */
export const COVERAGE = 1 / (BAR_GAP * MIN_FAVICON);

/** Edge length of the Apple icon grid. */
export const APPLE_CANVAS = 1024;

/**
 * Fraction of the Apple canvas the mark spans.
 *
 * @remarks
 * Set independently of {@link COVERAGE} because the two canvases mean different things. The web
 * mark sits on a plate this package draws and is bounded by the 16px favicon. The Apple mark sits
 * on a grid whose mask Apple applies, and its usable area is the largest centred square inside
 * that mask — measured at 869px of the 1024px canvas.
 *
 * 726/1024 puts the mark at 726px square — 84% of that live area, and 71% of the canvas. It is
 * 720 rounded to the nearest multiple of 11, so the bars are 198 wide and the gaps 66 rather than
 * a repeating decimal. The
 * outgoing asset used 800, which measured 92% of the live area and left the bars close enough to
 * the mask that the icon read as cramped; Apple's own icons sit nearer 60–65% of the canvas. 720
 * is the compromise: enough air to look like an app icon, still large enough that "take advantage
 * of the space" holds.
 *
 * **Concentricity is not defined against Apple's mask.** It is a continuous-curvature squircle,
 * not a rounded rectangle with a circular corner arc, so there is no radius to share a centre
 * with. The mark is square and centred, which is as close as the constraint can be carried onto a
 * plate this package does not draw.
 */
export const APPLE_COVERAGE = 726 / APPLE_CANVAS;

/**
 * Fraction of a maskable icon's width the artwork may occupy.
 *
 * @remarks
 * The maskable spec guarantees only the centre 80% circle survives cropping. Rendering at 60%
 * keeps the mark inside that circle under the most aggressive squircle mask, at the cost of the
 * icon reading slightly smaller — the correct trade, since a clipped logo reads as a bug and a
 * small one does not.
 */
export const MASKABLE_SCALE = 0.6;

/** A measured rectangle. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A path laid out on a specific canvas. */
export interface MarkGeometry {
  /** Each bar as its own subpath, left to right. */
  readonly bars: readonly string[];
  /** Every bar joined — one `d` attribute covering the whole mark, for measuring it. */
  readonly d: string;
  /** Ink bounding box on that canvas. Square, by construction. */
  readonly bbox: Bounds;
  /** Width of a single bar, in canvas units. */
  readonly barWidth: number;
  /** Gap between adjacent bars, in canvas units. */
  readonly gap: number;
  /** Radius of a bar's stadium cap, in canvas units. */
  readonly capRadius: number;
  /** Margin from the mark's bounding box to the canvas edge, equal on all four sides. */
  readonly margin: number;
}

/**
 * Measure a path's ink bounds.
 *
 * @remarks
 * Exported so consumers can check a committed asset against the geometry this module computes
 * without taking their own dependency on a path-measuring library, and without the alternative: a
 * regex over the SVG, which is what the Apple geometry test used to do and which silently returned
 * nothing the moment the mark stopped being a set of `<rect>` elements.
 *
 * @param d - An SVG path's `d` attribute.
 * @returns The bounding box of the drawn artwork, arc extrema included.
 */
export function pathBounds(d: string): Bounds {
  const [minX, minY, maxX, maxY] = svgPathBbox(d);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The plate's corner radius, solved so its corner is concentric with the bars' caps.
 *
 * @remarks
 * Two rounded shapes nest correctly when their corner arcs share a centre, not when their radii
 * match. The plate's top-left arc is centred at `(R, R)`. The left bar's top cap is a semicircle
 * of radius `r = barWidth / 2`, centred at `(margin + r, margin + r)` — the bar's left edge sits
 * at `margin`, and the cap's centre is `r` in from both the left and the top.
 *
 * Setting those equal gives `R = margin + r`, which is all this function is.
 *
 * **It is concentric horizontally, and deliberately not vertically.** {@link OPTICAL_SHIFT} moves
 * the mark down so its centre of mass meets the plate's, which makes the top margin larger than
 * the side margins — and one radius cannot share a centre with the cap arcs on both axes. The side
 * margin is the one used here, because the tall left bar runs the full height of the mark and its
 * edge is what the eye reads against the plate's edge. Optical balance is what a viewer perceives;
 * a concentricity violation at the top is not.
 *
 * This still replaces the `rx="7"` the mark carried since it was drawn, which was concentric with
 * nothing on either axis.
 *
 * @param canvas - Canvas edge length.
 * @param coverage - Fraction of the canvas the mark spans. Defaults to {@link COVERAGE}.
 * @returns The plate's corner radius, in canvas units.
 */
export function plateRadius(canvas: number, coverage: number = COVERAGE): number {
  const { margin, capRadius } = markPath(canvas, coverage);
  return margin + capRadius;
}

/**
 * One bar as a stadium: a rectangle capped by a semicircle at each end.
 *
 * @remarks
 * Emitted as arcs rather than as a `<rect rx="…">` so the whole mark is a single `<path>`. That is
 * what lets both test suites *measure* the committed artwork with {@link pathBounds} instead of
 * pattern-matching element attributes, and it is what keeps the Icon Composer layer a single shape
 * rather than three.
 *
 * @param x - Left edge.
 * @param y - Top edge.
 * @param width - Bar width; the cap radius is half of it.
 * @param height - Bar height, cap to cap.
 * @returns A closed subpath.
 */
function bar(x: number, y: number, width: number, height: number): string {
  const r = width / 2;
  const round = (value: number): string => Number(value.toFixed(3)).toString();
  const arc = (toX: number, toY: number): string =>
    `A${round(r)} ${round(r)} 0 0 1 ${round(toX)} ${round(toY)}`;

  // Each cap is two quarter arcs rather than one semicircle, so the topmost and bottommost points
  // are explicit coordinates. A single semicircle puts them at the arc's extremum instead, where
  // the sagitta is `r - sqrt(r² - (chord/2)²)` — rounding the radius and the chord independently
  // leaves them a hair apart, the square root amplifies that hair, and a 0.001 rounding becomes a
  // 0.05 error in the measured bounding box.
  return (
    `M${round(x)} ${round(y + r)}` +
    arc(x + r, y) +
    arc(x + width, y + r) +
    `V${round(y + height - r)}` +
    arc(x + r, y + height) +
    arc(x, y + height - r) +
    'Z'
  );
}

/**
 * Lay the mark out on a square canvas.
 *
 * @remarks
 * `coverage` sizes the mark's bounding box, which is square: the tallest bar's height and the
 * three-bars-plus-two-gaps width are equal by the solution described on {@link BAR_WIDTH}. The
 * shorter two bars are top-aligned inside it.
 *
 * @param canvas - Canvas edge length, in the units the output path should use.
 * @param coverage - Fraction of the canvas the mark spans. Defaults to {@link COVERAGE}.
 * @returns The laid-out path and the geometry it was measured at.
 *
 * @example
 * ```typescript
 * const { d } = markPath(32);
 * // → `<path fill="#FAFAFA" d="${d}" />` inside a 32x32 viewBox
 * ```
 */
export function markPath(canvas: number, coverage: number = COVERAGE): MarkGeometry {
  const side = coverage * canvas;
  const barWidth = BAR_WIDTH * side;
  const gap = BAR_GAP * side;
  const margin = (canvas - side) / 2;
  const top = margin + OPTICAL_SHIFT * side;

  const bars = BAR_HEIGHTS.map((ratio, index) =>
    bar(margin + index * (barWidth + gap), top, barWidth, side * ratio),
  );

  return {
    bars,
    d: bars.join(''),
    bbox: { x: margin, y: top, w: side, h: side },
    barWidth,
    gap,
    capRadius: barWidth / 2,
    margin,
  };
}
