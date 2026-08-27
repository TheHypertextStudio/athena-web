/**
 * The Apple asset set: what gets exported from the Icon Composer document, at what size, and in
 * which appearance.
 *
 * @remarks
 * Kept apart from {@link file://./render-apple.ts} so tests can read the list without the
 * renderer's `main()` firing on import.
 */
import { join } from 'node:path';

import { APPLE_CANVAS } from './mark';
import { EXPORTS_DIR, WEB_ROOT } from './paths';

/**
 * An appearance Icon Composer can render.
 *
 * @remarks
 * These are the six `--rendition` values `ictool` accepts. Only `Default` is shipped: a
 * home-screen web clip is handed exactly one `apple-touch-icon`, and no Apple platform has ever
 * offered a dark or tinted appearance for one. The other five exist as reviewable masters and as
 * groundwork for a native target.
 */
export type AppleRendition =
  'Default' | 'Dark' | 'TintedLight' | 'TintedDark' | 'ClearLight' | 'ClearDark';

/** One exported Apple asset. */
export interface AppleIconExport {
  /** Absolute path to write. */
  readonly outPath: string;
  /** Output edge length in pixels (Apple icons are always square). */
  readonly size: number;
  /** Which platform mask and material Icon Composer should render with. */
  readonly platform: 'iOS' | 'macOS';
  /** Which appearance to render. */
  readonly rendition: AppleRendition;
  /** Whether the file is served to browsers, as opposed to kept for review. */
  readonly served: boolean;
}

/**
 * The four sizes iOS and iPadOS actually request.
 *
 * @remarks
 * Safari picks the `apple-touch-icon` whose declared size best matches the device, and Next's
 * `apple-icon<n>.png` file convention emits one `<link rel="apple-touch-icon" sizes="…">` per
 * numbered file with the size read from the image itself.
 */
const SERVED_SIZES = [120, 152, 167, 180] as const;

/** File-name suffix for each non-default appearance master. */
const MASTER_SUFFIX: Readonly<Record<Exclude<AppleRendition, 'Default'>, string>> = {
  Dark: 'dark',
  TintedLight: 'tinted-light',
  TintedDark: 'tinted-dark',
  ClearLight: 'clear-light',
  ClearDark: 'clear-dark',
};

/**
 * Every asset the exporter writes, in the order Next numbers the served ones.
 *
 * @remarks
 * The 1024px `Default` master keeps its bare filename because it is the input to the geometry
 * check in `apps/web/tests/pwa/apple-icons.test.ts`, which measures live-area coverage and mask
 * clearance on real pixels rather than trusting a number written down here.
 *
 * Only the `iOS` rendition is committed at 1024: at that size the macOS `Default` render is
 * byte-for-byte identical (macOS 26 adopted the same rounded-rect grid), so a second copy would
 * be a duplicate binary rather than evidence of anything.
 */
export const APPLE_ICONS: readonly AppleIconExport[] = [
  ...SERVED_SIZES.map((size, index) => ({
    outPath: join(WEB_ROOT, `src/app/apple-icon${String(index)}.png`),
    size,
    platform: 'iOS' as const,
    rendition: 'Default' as const,
    served: true,
  })),
  {
    outPath: join(EXPORTS_DIR, 'apple-icon-1024.png'),
    size: APPLE_CANVAS,
    platform: 'iOS',
    rendition: 'Default',
    served: false,
  },
  ...Object.entries(MASTER_SUFFIX).map(([rendition, suffix]) => ({
    outPath: join(EXPORTS_DIR, `apple-icon-1024-${suffix}.png`),
    size: APPLE_CANVAS,
    platform: 'iOS' as const,
    rendition: rendition as AppleRendition,
    served: false,
  })),
];
