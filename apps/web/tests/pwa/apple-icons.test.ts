import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';

/**
 * The Apple home-screen icon set: where it comes from, how much of the grid it uses, and the
 * guarantee that adding it changed nothing on any other platform.
 *
 * @remarks
 * Every geometric claim here is measured off the committed 1024px render rather than restated from
 * a number someone wrote down. The **live area** is computed the only way that is honest without
 * quoting a figure this repository cannot verify: it is the largest centred square that is fully
 * opaque in Apple's own rendered mask, found by bisection on the real pixels. That makes the
 * coverage assertions independent of which mask shape Icon Composer applies, and they keep working
 * if Apple changes it.
 *
 * The non-interference guarantee (CAL-37) is asserted structurally, not by eyeballing a diff: the
 * two generator scripts are read as text and each is required to write nothing into the other's
 * directory, and the manifest is required to name no Apple asset at all. A diff can only tell you
 * about the change that already happened; this fails the next one too.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MASTER = join(WEB_ROOT, 'design/exports/apple-icon-1024.png');
const ICON_DOCUMENT = join(WEB_ROOT, 'design/Docket.icon');

/** The four sizes iOS and iPadOS actually request, in Next's numbering order. */
const SERVED_SIZES = [120, 152, 167, 180];

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A script's executable text, with comments removed.
 *
 * @remarks
 * These files document each other at length — `generate-pwa-icons.ts` explains that it no longer
 * writes any Apple asset, and `export-apple-icons.ts` explains that it does not rasterize anything.
 * Scanning the raw text would therefore fail on the prose that asserts the very property being
 * checked. Block comments and whole-line `//` comments are stripped; trailing `//` is left alone so
 * a `https://` inside a string literal survives.
 */
function codeOf(file: string): string {
  return readFileSync(join(WEB_ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The authored mark, read from the Icon Composer document's own layer. */
function markRects(): readonly Rect[] {
  const svg = readFileSync(join(ICON_DOCUMENT, 'Assets/Bars.svg'), 'utf8');
  return [
    ...svg.matchAll(
      /<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g,
    ),
  ].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    w: Number(match[3]),
    h: Number(match[4]),
  }));
}

interface Raster {
  readonly width: number;
  readonly height: number;
  /** Whether the rendered icon is fully opaque at a point — i.e. inside Apple's mask. */
  opaque(x: number, y: number): boolean;
}

async function raster(file: string): Promise<Raster> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const clamp = (value: number, max: number): number =>
    Math.round(Math.min(Math.max(value, 0), max - 1));
  return {
    width: info.width,
    height: info.height,
    opaque: (x, y) => {
      const offset =
        (clamp(y, info.height) * info.width + clamp(x, info.width)) * info.channels + 3;
      return (data[offset] ?? 0) > 250;
    },
  };
}

/** The largest centred square that is entirely inside the rendered mask. */
function liveAreaSide(image: Raster): number {
  const cx = image.width / 2;
  const cy = image.height / 2;
  let lo = 0;
  let hi = image.width / 2;
  for (let step = 0; step < 24; step += 1) {
    const half = (lo + hi) / 2;
    const inside =
      image.opaque(cx - half, cy - half) &&
      image.opaque(cx + half - 1, cy - half) &&
      image.opaque(cx - half, cy + half - 1) &&
      image.opaque(cx + half - 1, cy + half - 1);
    if (inside) lo = half;
    else hi = half;
  }
  return lo * 2;
}

describe('the Apple icon source document', () => {
  it('is an Icon Composer document, committed, and is what the exports come from', () => {
    const document = JSON.parse(readFileSync(join(ICON_DOCUMENT, 'icon.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    // A `.icon` package is a directory of `icon.json` + `Assets/`, which is what Icon Composer
    // writes and what `ictool` reads.
    expect(readdirSync(ICON_DOCUMENT).sort()).toEqual(['Assets', 'icon.json']);
    expect(document['supported-platforms']).toEqual({
      circles: ['watchOS'],
      squares: ['iOS', 'macOS'],
    });
  });

  it('declares the Liquid Glass treatment rather than a flat image', () => {
    const document = JSON.parse(readFileSync(join(ICON_DOCUMENT, 'icon.json'), 'utf8')) as {
      groups: { specular?: boolean; translucency?: { enabled?: boolean }; layers: unknown[] }[];
    };
    const group = document.groups[0];
    // These three are what make it glass: a refracting layer, its specular edge, and the shadow it
    // casts on the plate. A flat PNG can express none of them, which is why the source is a
    // layered document at all.
    expect(group?.specular).toBe(true);
    expect(group?.translucency?.enabled).toBe(true);
    expect(group?.layers).toHaveLength(1);
  });

  it('is rendered by Apple’s exporter, never by this repository', () => {
    const script = codeOf('scripts/export-apple-icons.ts');
    expect(script).toContain('Icon Composer.app/Contents/Executables/ictool');
    expect(script).toContain('--export-image');
    // sharp appears only to re-encode ictool's 16-bit output at 8 bits; it must never rasterize,
    // resize or composite, or the shipped asset would stop being Icon Composer's render.
    expect(script).not.toContain('.resize(');
    expect(script).not.toContain('.composite(');
    expect(script).not.toContain('.svg');
  });
});

describe('the served Apple asset set', () => {
  it('ships every size iOS asks for, at the size it claims', async () => {
    const files = readdirSync(join(WEB_ROOT, 'src/app'))
      .filter((name) => /^apple-icon\d*\.png$/.test(name))
      .sort();
    expect(files).toEqual([
      'apple-icon0.png',
      'apple-icon1.png',
      'apple-icon2.png',
      'apple-icon3.png',
    ]);

    for (const [index, file] of files.entries()) {
      const meta = await sharp(join(WEB_ROOT, 'src/app', file)).metadata();
      expect(meta.width, `${file} width`).toBe(SERVED_SIZES[index]);
      expect(meta.height, `${file} height`).toBe(SERVED_SIZES[index]);
    }
  });

  it('is distinct artwork, not the standard icon under another name', async () => {
    const apple = await sharp(join(WEB_ROOT, 'src/app/apple-icon3.png')).raw().toBuffer();
    const standard = await sharp(join(WEB_ROOT, 'public/icons/icon-192.png'))
      .resize(180, 180)
      .raw()
      .toBuffer();
    expect(Buffer.compare(apple, standard)).not.toBe(0);
  });
});

describe('non-interference with every other platform', () => {
  it('keeps the manifest free of Apple assets', () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => icon.src)).toEqual([
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-192-maskable.png',
      '/icons/icon-512-maskable.png',
    ]);
    expect(icons.filter((icon) => icon.purpose === 'maskable')).toHaveLength(2);
    expect(icons.some((icon) => icon.src.includes('apple'))).toBe(false);
  });

  it('gives the two generators disjoint outputs, so neither can touch the other’s icons', () => {
    const android = codeOf('scripts/generate-pwa-icons.ts');
    const apple = codeOf('scripts/export-apple-icons.ts');

    // The Android/Chrome generator is still the only writer of everything the manifest names…
    expect(android).toContain("outPath: 'public/icons/icon-192.png'");
    expect(android).not.toContain('apple-icon');
    // …and the Apple exporter writes only Apple assets and its own review master.
    expect(apple).not.toContain('public/icons');
  });
});

describe('use of the Apple icon grid', () => {
  it('fills the canvas — the mask reaches all four edges', async () => {
    const image = await raster(MASTER);
    const cx = image.width / 2;
    const cy = image.height / 2;
    expect(image.opaque(cx, 0)).toBe(true);
    expect(image.opaque(cx, image.height - 1)).toBe(true);
    expect(image.opaque(0, cy)).toBe(true);
    expect(image.opaque(image.width - 1, cy)).toBe(true);
  });

  it('uses most of the live area rather than floating in the middle of it', async () => {
    const image = await raster(MASTER);
    const live = liveAreaSide(image);
    const rects = markRects();
    const x0 = Math.min(...rects.map((rect) => rect.x));
    const x1 = Math.max(...rects.map((rect) => rect.x + rect.w));
    const y0 = Math.min(...rects.map((rect) => rect.y));
    const y1 = Math.max(...rects.map((rect) => rect.y + rect.h));

    // Measured at the time of writing: 869px live area, mark 750x800 → 86.3% x 92.1%. The previous
    // asset used roughly a quarter of the canvas, which is what "take advantage of space" was
    // asking about.
    expect((x1 - x0) / live).toBeGreaterThan(0.8);
    expect((y1 - y0) / live).toBeGreaterThan(0.85);
  });

  it('is centred on both axes', () => {
    const rects = markRects();
    const x0 = Math.min(...rects.map((rect) => rect.x));
    const x1 = Math.max(...rects.map((rect) => rect.x + rect.w));
    const y0 = Math.min(...rects.map((rect) => rect.y));
    const y1 = Math.max(...rects.map((rect) => rect.y + rect.h));
    expect(Math.abs((x0 + x1) / 2 - 512)).toBeLessThanOrEqual(1);
    expect(Math.abs((y0 + y1) / 2 - 512)).toBeLessThanOrEqual(1);
  });

  it('never touches the mask edge', async () => {
    const image = await raster(MASTER);
    // Each bar is a rounded rect, so its bounding-box corners lie outside the drawn artwork —
    // testing them is deliberately stricter than testing the ink itself.
    for (const rect of markRects()) {
      const corners: readonly (readonly [number, number])[] = [
        [rect.x, rect.y],
        [rect.x + rect.w, rect.y],
        [rect.x, rect.y + rect.h],
        [rect.x + rect.w, rect.y + rect.h],
      ];
      for (const [x, y] of corners) {
        expect(image.opaque(x, y), `corner ${String(x)},${String(y)} inside the mask`).toBe(true);
        // …and with room to spare, so a slightly different mask on a future OS cannot clip it.
        expect(
          image.opaque(x + Math.sign(512 - x) * -16, y + Math.sign(512 - y) * -16),
          `corner ${String(x)},${String(y)} has 16px of clearance`,
        ).toBe(true);
      }
    }
  });
});
