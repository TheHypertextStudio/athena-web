/**
 * `pnpm --filter @docket/brand icons:pwa` — render the installed-icon set the web app manifest
 * names.
 *
 * @remarks
 * The PNGs are **committed**, not built on demand. Installability must not depend on a build step
 * running `sharp` (the Docker image copies `public/` verbatim), and committing them keeps the
 * artwork reviewable in a diff.
 *
 * Two purposes are emitted, and the distinction matters:
 *
 * - `any` — the mark edge to edge. Used wherever the platform draws the icon as-is.
 * - `maskable` — the mark inset into the ~80% safe zone on an opaque bleed. Android crops icons to
 *   a circle or squircle of its choosing; without the inset the outer bars get clipped, and the
 *   bleed is the mark's own plate colour so the crop is invisible.
 *
 * **This script writes no Apple asset.** It builds its own document through
 * {@link file://./svg.ts | platedMarkSvg} rather than reading `icon.svg` off disk, so a stale or
 * hand-edited favicon cannot silently become the installed icon.
 *
 * @see {@link file://../../../apps/web/src/app/manifest.ts} which references these outputs.
 * @see {@link file://./render-apple.ts} for the Apple home-screen set, which this must never touch.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import { MASKABLE_SCALE, PLATE } from './mark';
import { PWA_ICONS_DIR } from './paths';
import { platedMarkSvg } from './svg';

/** A single generated icon file. */
interface IconSpec {
  /** File name inside {@link PWA_ICONS_DIR}. */
  readonly name: string;
  /** Output edge length in pixels (icons are always square). */
  readonly size: number;
  /** Whether to inset the artwork into the maskable safe zone over an opaque bleed. */
  readonly maskable: boolean;
}

const ICONS: readonly IconSpec[] = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-192-maskable.png', size: 192, maskable: true },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
];

/**
 * Render one icon.
 *
 * @remarks
 * The SVG is authored at the exact output size and rasterized once, so the rounded plate corners
 * and bar ends stay crisp at 512px instead of being resampled from a smaller bitmap. A maskable
 * icon composites that render, drawn at {@link MASKABLE_SCALE}, onto a full-bleed plate.
 *
 * @param spec - What to render and where to put it.
 * @returns The number of bytes written.
 */
async function renderIcon(spec: IconSpec): Promise<number> {
  const { name, size, maskable } = spec;
  const artworkSize = maskable ? Math.round(size * MASKABLE_SCALE) : size;
  const artwork = await sharp(Buffer.from(platedMarkSvg(artworkSize)))
    .png()
    .toBuffer();

  const png = maskable
    ? await sharp({
        create: { width: size, height: size, channels: 4, background: PLATE },
      })
        .composite([{ input: artwork, gravity: 'centre' }])
        .png()
        .toBuffer()
    : artwork;

  await writeFile(join(PWA_ICONS_DIR, name), png);
  return png.byteLength;
}

async function main(): Promise<void> {
  await mkdir(PWA_ICONS_DIR, { recursive: true });
  for (const spec of ICONS) {
    const bytes = await renderIcon(spec);
    process.stdout.write(
      `apps/web/public/icons/${spec.name} — ${String(spec.size)}px, ${String(bytes)} bytes\n`,
    );
  }
}

await main();
