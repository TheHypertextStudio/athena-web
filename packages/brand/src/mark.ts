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

/** The plate behind the mark, and the bleed colour behind a maskable icon. */
export const PLATE = '#1C1C1F';

/** The bars. One value in both schemes: the plate is what changes, never the ink. */
export const INK = '#FAFAFA';

/**
 * The design token the accent bar is painted with.
 *
 * @remarks
 * Docket's tokens are OKLCH and shift between light and dark; an installed icon is a single fixed
 * image and cannot follow them. The light-mode value is the one that carries the brand — it is the
 * indigo that appears on buttons, focus rings and selection — so that is the one baked in.
 * `--primary` in dark mode is a pale periwinkle that reads as a tinted white bar rather than as a
 * colour, which defeats the point of accenting a bar at all.
 *
 * @see {@link file://../../ui/src/styles/globals.css} — the declaration this must stay equal to.
 */
export const ACCENT_TOKEN = { name: '--primary', scheme: 'light', oklch: 'oklch(0.52 0.21 264)' };

/**
 * The accent bar's fill: `--primary`, converted from OKLCH.
 *
 * @remarks
 * Computed rather than pasted, and {@link file://../tests/mark.test.ts} re-reads the stylesheet and
 * re-derives it, so editing the token without regenerating the icons fails the suite instead of
 * leaving the mark quietly off-brand.
 */
export const ACCENT = oklchToHex(0.52, 0.21, 264);

/**
 * Which bar carries the accent.
 *
 * @remarks
 * The last one. It is the medium-height bar on the right, so the colour lands on a shape big
 * enough to read at 16px without becoming the dominant element the way the tallest bar would.
 */
export const ACCENT_BAR = 2;

/**
 * Bar heights, as fractions of the tallest bar.
 *
 * @remarks
 * `16 / 10 / 13` from the mark this replaced, which is where its balance came from. Material draws
 * the middle bar at half the tall one; that stubbier version leaves a visible hole under it and
 * was rejected in review alongside the thin bars.
 */
export const BAR_HEIGHTS = [1, 0.625, 0.8125] as const;

/**
 * Bar width, as a fraction of the mark's side.
 *
 * @remarks
 * Solved rather than picked. Two constraints fix it:
 *
 * 1. **The mark must be square.** Concentric corners require the same margin on all four sides,
 *    so the three bars plus two gaps must span exactly the tallest bar's height:
 *    `3w + 2g = 1`.
 * 2. **The bar-to-gap ratio is 8:3**, from the weight chosen in design review — 200 wide with 75
 *    of gap on the 800-unit Apple grid, compared side by side as real `ictool` renders rather than
 *    as numbers in an editor.
 *
 * Substituting `g = 3w/8` into the first gives `3.75w = 1`, so `w = 4/15` and `g = 1/10`. The
 * fractions are exact; `3(4/15) + 2(1/10)` is exactly 1.
 */
export const BAR_WIDTH = 4 / 15;

/**
 * Gap between bars, as a fraction of the mark's side.
 *
 * @remarks
 * The other half of the solution described on {@link BAR_WIDTH}. Tighter than the mark this
 * replaced, whose gap was 0.375 of a bar width against this 0.375 — the same ratio, but the bars
 * are now a larger share of a larger mark, so the grouping reads tighter at every size.
 */
export const BAR_GAP = 1 / 10;

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
 * 800/1024 puts the mark at 800px square, which is 92% of that live area and the height the
 * outgoing asset used, so the redesign stayed about the bars rather than about the size.
 *
 * **Concentricity is not defined against Apple's mask.** It is a continuous-curvature squircle,
 * not a rounded rectangle with a circular corner arc, so there is no radius to share a centre
 * with. The mark is square and centred, which is as close as the constraint can be carried onto a
 * plate this package does not draw.
 */
export const APPLE_COVERAGE = 800 / APPLE_CANVAS;

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
  /** Each bar as its own subpath, left to right, so {@link ACCENT_BAR} can be painted separately. */
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
 * Setting those equal gives `R = margin + r`, which is all this function is. It is also why the
 * mark has to be square: with different horizontal and vertical margins the cap centre is at
 * `(margin_x + r, margin_y + r)`, which no single radius can meet.
 *
 * This replaces the `rx="7"` the mark carried since it was drawn, which was concentric with
 * nothing.
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

  const bars = BAR_HEIGHTS.map((ratio, index) =>
    bar(margin + index * (barWidth + gap), margin, barWidth, side * ratio),
  );

  return {
    bars,
    d: bars.join(''),
    bbox: { x: margin, y: margin, w: side, h: side },
    barWidth,
    gap,
    capRadius: barWidth / 2,
    margin,
  };
}
