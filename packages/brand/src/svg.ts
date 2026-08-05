/**
 * SVG documents built from {@link markPath}. Every renderer and the offline-page drift check emit
 * their markup through these, so no two callers can disagree about what the mark looks like.
 */
import { COVERAGE, INK, markPath, PLATE, plateRadius } from './mark';

/** The coordinate space every web-side document is authored in. */
export const CANVAS = 32;

/** Round to three decimals and drop the trailing zeros, so the markup stays readable. */
function trim(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/**
 * The mark on its plate.
 *
 * @remarks
 * One document for every raster surface — favicon, PWA icons, the offline page — because the plate
 * is the brand colour and needs no per-scheme branch.
 *
 * It used to carry one: the plate was near-black and vanished into a dark browser tab strip, so it
 * was dropped under `@media (prefers-color-scheme: dark)` to leave the bars reading as a glyph.
 * An indigo plate has an edge against light and dark chrome alike, so that branch now solves a
 * problem that no longer exists — and would actively hurt, since dropping the plate in dark mode
 * is dropping the brand colour. It is gone, and the icon is one fixed image everywhere.
 *
 * @param size - Rendered width and height.
 * @param coverage - Fraction of the canvas the mark spans. Defaults to {@link COVERAGE}.
 * @param viewBox - Coordinate space. Defaults to `size`, so the document is 1:1.
 * @returns A complete SVG document.
 */
export function platedMarkSvg(
  size: number,
  coverage: number = COVERAGE,
  viewBox: number = size,
): string {
  const { bars } = markPath(viewBox, coverage);
  return `<svg width="${trim(size)}" height="${trim(size)}" viewBox="0 0 ${trim(viewBox)} ${trim(viewBox)}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${trim(viewBox)}" height="${trim(viewBox)}" rx="${trim(plateRadius(viewBox, coverage))}" fill="${PLATE}" />
  <path fill="${INK}" d="${bars.join('')}" />
</svg>
`;
}

/**
 * The mark at the favicon's authored size.
 *
 * @remarks
 * Fixed at the {@link CANVAS} coordinate space regardless of how large it is drawn, so the favicon
 * and the copy inlined into the offline page are the same document at two display sizes rather
 * than two documents that have to be kept equal.
 *
 * @param size - Rendered width and height. Defaults to {@link CANVAS}.
 * @returns A complete SVG document.
 */
export function faviconSvg(size: number = CANVAS): string {
  return platedMarkSvg(size, COVERAGE, CANVAS);
}

/**
 * The bars alone, with no plate.
 *
 * @remarks
 * The layer inside the Icon Composer document. Apple's plate is the gradient declared in
 * `icon.json` and its material is applied by `IconRendering`, so shipping a plate here would put a
 * flat rectangle underneath the glass instead of letting the glass be the background.
 *
 * @param size - Edge length of both the document and its coordinate space.
 * @param coverage - Fraction of the canvas the mark spans.
 * @returns A complete SVG document containing the bars and nothing else.
 */
export function bareMarkSvg(size: number, coverage: number): string {
  const { bars } = markPath(size, coverage);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${trim(size)}" height="${trim(size)}" viewBox="0 0 ${trim(size)} ${trim(size)}">
  <path fill="${INK}" d="${bars.join('')}" />
</svg>
`;
}
