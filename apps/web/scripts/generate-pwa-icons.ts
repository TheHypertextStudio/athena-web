/**
 * `pnpm --filter @docket/web exec tsx scripts/generate-pwa-icons.ts` — render the PWA icon set
 * from the single source of truth, {@link file://../src/app/icon.svg}.
 *
 * @remarks
 * The generated PNGs are **committed**, not built on demand. Installability must not depend on a
 * build step running `sharp` (the Docker image copies `public/` verbatim), and committing them
 * keeps the artwork reviewable in a diff. Re-run this script whenever the brand mark changes.
 *
 * Two purposes are emitted, and the distinction matters:
 *
 * - `any` — the mark edge to edge. Used wherever the platform draws the icon as-is.
 * - `maskable` — the mark inset into the ~80% safe zone on an opaque bleed. Android crops icons to
 *   a circle/squircle of its choosing; without the inset, the outer bars of the Docket glyph get
 *   clipped. The bleed colour is the mark's own background so the crop is invisible.
 *
 * **This script no longer writes any Apple asset.** It used to emit `src/app/apple-icon.png` — the
 * standard maskable render at 180px — which is what Safari installed on the home screen. Apple's
 * platforms now expect a Liquid Glass icon, which is a layered document rendered by Apple's own
 * `IconRendering` framework and is not reachable from `sharp` at all. That set is owned by
 * {@link file://./export-apple-icons.ts}, which reads `design/Docket.icon` and writes
 * `src/app/apple-icon<n>.png`.
 *
 * The split is deliberate rather than tidy-minded: it is what guarantees the Apple work cannot
 * alter the Android/Chrome icons. Neither script can write the other's outputs, and this one is
 * still the only writer of every file the manifest names.
 *
 * @see {@link file://../src/app/manifest.ts} which references the `public/icons/*` outputs.
 * @see {@link file://./export-apple-icons.ts} for the Apple home-screen set.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const SOURCE_SVG = join(WEB_ROOT, 'src/app/icon.svg');
const ICONS_DIR = join(WEB_ROOT, 'public/icons');

/**
 * The mark's own background, taken from the `<rect>` fill in `icon.svg`.
 *
 * @remarks
 * Used as the opaque bleed behind maskable and Apple icons. Deliberately not a theme token: those
 * are OKLCH and shift between light and dark, whereas an installed icon is a single fixed image.
 */
const BLEED = '#1C1C1F';

/**
 * Fraction of a maskable icon's width the artwork may occupy.
 *
 * @remarks
 * The maskable spec guarantees only the centre 80% circle survives cropping. Rendering the mark at
 * 60% leaves the glyph comfortably inside that circle even under the most aggressive squircle mask,
 * at the cost of the icon reading slightly smaller — the correct trade, since a clipped logo reads
 * as a bug and a small one does not.
 */
const MASKABLE_SCALE = 0.6;

/** A single generated icon file. */
interface IconSpec {
  /** Path to write, relative to the web app root. */
  readonly outPath: string;
  /** Output edge length in pixels (icons are always square). */
  readonly size: number;
  /** Whether to inset the artwork into the maskable safe zone over an opaque bleed. */
  readonly maskable: boolean;
}

const ICONS: readonly IconSpec[] = [
  { outPath: 'public/icons/icon-192.png', size: 192, maskable: false },
  { outPath: 'public/icons/icon-512.png', size: 512, maskable: false },
  { outPath: 'public/icons/icon-192-maskable.png', size: 192, maskable: true },
  { outPath: 'public/icons/icon-512-maskable.png', size: 512, maskable: true },
];

/**
 * Render one icon from the source SVG.
 *
 * @param spec - What to render and where to put it.
 * @returns The number of bytes written.
 */
async function renderIcon(spec: IconSpec): Promise<number> {
  const { size, maskable } = spec;
  // Rasterize from the SVG at the exact size needed rather than upscaling a bitmap, so the
  // rounded corners and bar edges stay crisp at 512px.
  const artworkSize = maskable ? Math.round(size * MASKABLE_SCALE) : size;
  const artwork = await sharp(SOURCE_SVG, { density: 384 })
    .resize(artworkSize, artworkSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const png = maskable
    ? await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: BLEED,
        },
      })
        .composite([{ input: artwork, gravity: 'centre' }])
        .png()
        .toBuffer()
    : artwork;

  const target = join(WEB_ROOT, spec.outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, png);
  return png.byteLength;
}

async function main(): Promise<void> {
  await mkdir(ICONS_DIR, { recursive: true });
  for (const spec of ICONS) {
    const bytes = await renderIcon(spec);
    process.stdout.write(`${spec.outPath} — ${spec.size}px, ${String(bytes)} bytes\n`);
  }
}

await main();
