/**
 * SVG documents built from {@link markPath}. Every renderer and the offline-page drift check emit
 * their markup through these, so no two callers can disagree about what the mark looks like.
 */
import { ACCENT, ACCENT_BAR, COVERAGE, INK, markPath, PLATE, plateRadius } from './mark';

/** The coordinate space every web-side document is authored in. */
export const CANVAS = 32;

/** Round to three decimals and drop the trailing zeros, so the markup stays readable. */
function trim(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/**
 * The bars, as two `<path>` elements: the plain ones and the accented one.
 *
 * @remarks
 * Two elements rather than three so the markup stays small, and rather than one so the last bar
 * can carry {@link ACCENT}. Order matters only for readability; the bars do not overlap.
 *
 * @param bars - Per-bar subpaths from {@link markPath}.
 * @param indent - Leading whitespace for each line.
 * @returns The two elements, newline-separated.
 */
function barPaths(bars: readonly string[], indent: string): string {
  const plain = bars.filter((_, index) => index !== ACCENT_BAR).join('');
  const accent = bars[ACCENT_BAR] ?? '';
  return `${indent}<path fill="${INK}" d="${plain}" />\n${indent}<path fill="${ACCENT}" d="${accent}" />`;
}

/**
 * The mark on a plate that disappears in dark mode.
 *
 * @remarks
 * Chrome, Firefox and Edge re-evaluate `prefers-color-scheme` inside an SVG favicon and repaint
 * when the OS theme flips. Safari renders the file but ignores the media query, which is why the
 * plate is the *default* branch and its removal is the override: Safari and every rasterizer land
 * on the fully-painted tile, and only a browser that understands the query drops the plate.
 *
 * Without this the dark tile sits on a dark tab strip as a black rectangle with no edge. With it,
 * the bars read as a glyph directly on the strip.
 *
 * @param size - Rendered width and height. The coordinate space stays {@link CANVAS}.
 * @returns A complete SVG document.
 */
export function themedMarkSvg(size: number = CANVAS): string {
  const { bars } = markPath(CANVAS);
  return `<svg width="${trim(size)}" height="${trim(size)}" viewBox="0 0 ${trim(CANVAS)} ${trim(CANVAS)}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .plate { fill: ${PLATE} }
    @media (prefers-color-scheme: dark) { .plate { fill: none } }
  </style>
  <rect class="plate" width="${trim(CANVAS)}" height="${trim(CANVAS)}" rx="${trim(plateRadius(CANVAS))}" />
${barPaths(bars, '  ')}
</svg>
`;
}

/**
 * The mark on a plate that is always painted.
 *
 * @remarks
 * What the PWA icons rasterize from. An installed icon is one fixed image the OS keeps on a home
 * screen, so it must not inherit the favicon's dark branch — and rasterizing
 * {@link themedMarkSvg} would make the result depend on how the rasterizer treats a media query it
 * cannot evaluate. Emitting the plate unconditionally removes the question.
 *
 * @param size - Edge length of both the document and its coordinate space.
 * @param coverage - Fraction of the canvas the mark spans. Defaults to {@link COVERAGE}.
 * @returns A complete SVG document with an opaque plate.
 */
export function opaqueMarkSvg(size: number, coverage: number = COVERAGE): string {
  const { bars } = markPath(size, coverage);
  return `<svg width="${trim(size)}" height="${trim(size)}" viewBox="0 0 ${trim(size)} ${trim(size)}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${trim(size)}" height="${trim(size)}" rx="${trim(plateRadius(size, coverage))}" fill="${PLATE}" />
${barPaths(bars, '  ')}
</svg>
`;
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
${barPaths(bars, '  ')}
</svg>
`;
}
