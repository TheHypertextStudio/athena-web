/**
 * The Docket brand mark: three bars on a rounded plate, and the measured layout that places them.
 *
 * @remarks
 * This module is the only place in the repository that knows what the mark looks like. Every
 * asset — the browser favicon, the PWA icon set, the Apple Icon Composer layer, the glyph inlined
 * into the offline page — is rendered from {@link markPath}. Before this package existed the same
 * three bars were hand-typed into four files that drifted independently.
 *
 * **Nothing here is eyeballed.** The bars are not authored: they are the three bar subpaths of
 * Material Symbols' `view_kanban`, lifted verbatim from {@link GLYPH}. Their positions are
 * measured with `svg-path-bbox` and recomputed with `svgpath`, so "scale the mark to 69% of the
 * canvas" is arithmetic on real bounding boxes rather than a coordinate somebody nudged until it
 * looked right.
 *
 * @see {@link file://../../../docs/design/brand-mark.md} for why this glyph and these constants.
 */
import { svgPathBbox } from 'svg-path-bbox';
import svgpath from 'svgpath';

/**
 * The upstream glyph, quoted exactly as `@mui/icons-material` ships it.
 *
 * @remarks
 * `ViewKanbanRounded` is four subpaths: a rounded-rect frame followed by three stadium bars of
 * descending-then-middle height. Docket uses the bars only — the icon's own plate is the frame,
 * so keeping the glyph's would draw a box inside a box.
 *
 * Copied rather than imported because `@mui/icons-material` exports React components, not path
 * data; reaching the `d` string at runtime would mean rendering a component in a build script.
 * {@link file://../tests/mark.test.ts} asserts this string still matches the installed package,
 * so an upstream redraw fails the suite instead of going unnoticed.
 */
export const GLYPH = {
  /** npm package the path was taken from. */
  package: '@mui/icons-material',
  /** Module within that package. */
  module: 'ViewKanbanRounded',
  /** Upstream name in the Material Symbols set. */
  symbol: 'view_kanban',
  /** Material Symbols are Apache-2.0; attribution lives in `docs/design/brand-mark.md`. */
  license: 'Apache-2.0',
  /** MUI renders every icon in this coordinate space. */
  viewBox: 24,
  /** The complete `d` attribute, frame subpath included. */
  d: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M8 17c-.55 0-1-.45-1-1V8c0-.55.45-1 1-1s1 .45 1 1v8c0 .55-.45 1-1 1m4-5c-.55 0-1-.45-1-1V8c0-.55.45-1 1-1s1 .45 1 1v3c0 .55-.45 1-1 1m4 3c-.55 0-1-.45-1-1V8c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1',
} as const;

/** The plate behind the mark, and the bleed colour behind a maskable icon. */
export const PLATE = '#1C1C1F';

/** The bars. One value in both schemes: the plate is what changes, never the ink. */
export const INK = '#FAFAFA';

/** Plate corner radius as a fraction of the canvas — `rx="7"` on the original 32px mark. */
export const PLATE_RADIUS_RATIO = 7 / 32;

/**
 * Fraction of the canvas the mark's longer dimension spans.
 *
 * @remarks
 * The mark it replaces covered 47%, which left the glyph floating in the middle of a mostly empty
 * tile at every size. The bars are taller than they are wide, so this governs the height and the
 * width follows from the glyph's aspect ratio; scaling both to 69% independently would distort a
 * glyph whose proportions are not ours to change.
 */
export const COVERAGE = 0.69;

/**
 * Gap between bars, as a fraction of a bar's width.
 *
 * @remarks
 * Material draws the bars with a gap equal to their width (ratio 1.0), which reads as three
 * separate strokes rather than one mark. Halving it groups them without merging them.
 *
 * 0.5 is a floor, not a preference. At a 16px favicon the gap works out to
 * `1 * (0.69 / 10) * 16 ≈ 1.1` device pixels — the smallest value that still renders as a gap
 * rather than a grey smear. Tightening further (the outgoing mark used 0.375) puts it below one
 * pixel, and the bars bridge. {@link file://../tests/mark.test.ts} asserts the pixel floor
 * directly, so lowering this constant fails the suite.
 */
export const GAP_RATIO = 0.5;

/** Edge length of the Apple icon grid. */
export const APPLE_CANVAS = 1024;

/**
 * Fraction of the Apple canvas the mark's longer dimension spans.
 *
 * @remarks
 * Larger than {@link COVERAGE} because the two canvases mean different things. The web mark sits
 * on a plate it draws itself and needs margin inside it; the Apple mark sits on a grid whose mask
 * Apple applies, and its usable area is the largest centred square inside that mask — measured at
 * 869px of the 1024px canvas.
 *
 * 800/1024 puts the mark's height at 800px, which is 92% of that live area and exactly what the
 * outgoing asset used. Holding the height constant keeps this change about the glyph rather than
 * about the size, and preserves the mask clearance the geometry test enforces.
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

/** A path laid out on a specific canvas. */
export interface MarkGeometry {
  /** The `d` attribute, in the canvas' coordinate space. */
  readonly d: string;
  /** Ink bounding box on that canvas. */
  readonly bbox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Width of a single bar, in canvas units. */
  readonly barWidth: number;
  /** Gap between adjacent bars, in canvas units. */
  readonly gap: number;
}

/**
 * The three bar subpaths, in absolute coordinates and in left-to-right order.
 *
 * @remarks
 * Converting to absolute first is what makes splitting safe. Material writes the second and third
 * bars as relative `m` moves whose origin is wherever the previous subpath ended, so cutting the
 * raw string would silently relocate them.
 *
 * @returns Three `d` strings, the frame subpath discarded.
 * @throws {Error} If the upstream glyph stops being a frame plus exactly three bars.
 */
export function barSubpaths(): readonly string[] {
  const subpaths = svgpath(GLYPH.d)
    .abs()
    .toString()
    .split(/(?=M)/)
    .map((subpath) => subpath.trim())
    .filter(Boolean);
  if (subpaths.length !== 4) {
    throw new Error(
      `Expected ${GLYPH.module} to be a frame plus three bars, got ${String(subpaths.length)} subpaths.`,
    );
  }
  // Subpath 0 is the frame. Docket's plate already draws it.
  return subpaths.slice(1);
}

/** A measured rectangle. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Measure a path's ink bounds.
 *
 * @remarks
 * Exported so consumers can check a committed asset against the geometry this module computes
 * without taking their own dependency on a path-measuring library, and without the alternative:
 * a regex over the SVG, which is what the Apple geometry test used to do and which silently
 * returned nothing the moment the mark stopped being a set of `<rect>` elements.
 *
 * @param d - An SVG path's `d` attribute.
 * @returns The bounding box of the drawn artwork, curve extrema included.
 */
export function pathBounds(d: string): Bounds {
  const [minX, minY, maxX, maxY] = svgPathBbox(d);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Re-space the bars onto an even pitch derived from their own measured width.
 *
 * @remarks
 * Each bar keeps its shape and height; only its horizontal position moves. The first bar stays
 * put and the others are translated onto `barWidth * (1 + GAP_RATIO)` centres, which is what makes
 * the spacing a consequence of {@link GAP_RATIO} rather than of Material's original layout.
 *
 * @returns The re-spaced bars and the bar width they were measured at.
 * @throws {Error} If the bars are not all the same width, which the pitch calculation assumes.
 */
function respace(): { subpaths: readonly string[]; barWidth: number } {
  const original = barSubpaths();
  const boxes = original.map(pathBounds);
  const barWidth = boxes[0]?.w ?? 0;
  for (const box of boxes) {
    if (Math.abs(box.w - barWidth) > 1e-6) {
      throw new Error(`Bars are not a uniform width: ${boxes.map((b) => b.w).join(', ')}.`);
    }
  }

  const pitch = barWidth * (1 + GAP_RATIO);
  const left = boxes[0]?.x ?? 0;
  const subpaths = original.map((d, index) => {
    const from = boxes[index]?.x ?? 0;
    return svgpath(d)
      .translate(left + index * pitch - from, 0)
      .toString();
  });
  return { subpaths, barWidth };
}

/**
 * Lay the mark out on a square canvas.
 *
 * @remarks
 * The mark is scaled so its longer dimension spans `coverage` of the canvas, then centred on both
 * axes against its measured ink bounds — not against the glyph's nominal 24-unit box, which
 * includes empty margin and would leave the mark sitting low and left.
 *
 * @param canvas - Canvas edge length, in the units the output path should use.
 * @param coverage - Fraction of the canvas the longer dimension spans. Defaults to {@link COVERAGE}.
 * @returns The laid-out path and the geometry it was measured at.
 *
 * @example
 * ```typescript
 * const { d } = markPath(32);
 * // → `<path fill="#FAFAFA" d="${d}" />` inside a 32x32 viewBox
 * ```
 */
export function markPath(canvas: number, coverage: number = COVERAGE): MarkGeometry {
  const { subpaths, barWidth } = respace();
  const joined = subpaths.join('');
  const ink = pathBounds(joined);

  const scale = (coverage * canvas) / Math.max(ink.w, ink.h);
  const width = ink.w * scale;
  const height = ink.h * scale;
  const d = svgpath(joined)
    .scale(scale)
    .translate((canvas - width) / 2 - ink.x * scale, (canvas - height) / 2 - ink.y * scale)
    .round(3)
    .toString();

  return {
    d,
    bbox: { x: (canvas - width) / 2, y: (canvas - height) / 2, w: width, h: height },
    barWidth: barWidth * scale,
    gap: barWidth * GAP_RATIO * scale,
  };
}
