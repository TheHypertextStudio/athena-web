/**
 * `@docket/brand` — the Docket mark and everything generated from it.
 *
 * @remarks
 * Consumers want one of two things: the geometry (`markPath`, and the constants that place it) or
 * a ready-made SVG document (`themedMarkSvg` and friends). The renderers under `src/render-*.ts`
 * are executables rather than exports; run them with `pnpm --filter @docket/brand icons`.
 *
 * @see {@link file://../../../docs/design/brand-mark.md} for the design rationale.
 */
export { APPLE_ICONS, type AppleIconExport, type AppleRendition } from './apple-icons';
export { offlineMarkMarkup, withRegeneratedMark } from './offline';
export {
  ACCENT,
  ACCENT_BAR,
  ACCENT_TOKEN,
  APPLE_CANVAS,
  APPLE_COVERAGE,
  BAR_GAP,
  BAR_HEIGHTS,
  BAR_WIDTH,
  COVERAGE,
  INK,
  markPath,
  MASKABLE_SCALE,
  MIN_FAVICON,
  pathBounds,
  PLATE,
  plateRadius,
  PROVENANCE,
  type Bounds,
  type MarkGeometry,
} from './mark';
export { bareMarkSvg, CANVAS, opaqueMarkSvg, themedMarkSvg } from './svg';
export { inGamut, oklchToHex, parseOklch } from './color';
export {
  APPLE_LAYER,
  EXPORTS_DIR,
  ICON_DOCUMENT,
  OFFLINE_MARK_SIZE,
  OFFLINE_PAGE,
  PWA_ICONS_DIR,
  REPO_ROOT,
  WEB_ICON,
  WEB_ROOT,
} from './paths';
