import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPLE_CANVAS,
  APPLE_COVERAGE,
  APPLE_ICONS,
  BAR_HEIGHTS,
  BAR_WIDTH,
  ICON_DOCUMENT,
  markPath,
  OPTICAL_SHIFT,
  pathBounds,
  REPO_ROOT,
  type Bounds,
} from '@docket/brand';
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
 * two generators in `@docket/brand` are read as text and each is required to write nothing into
 * the other's directory, and the manifest is required to name no Apple asset at all. A diff can
 * only tell you about the change that already happened; this fails the next one too.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BRAND_ROOT = join(REPO_ROOT, 'packages/brand');
const MASTER = join(WEB_ROOT, 'design/exports/apple-icon-1024.png');

/** The four sizes iOS and iPadOS actually request, in Next's numbering order. */
const SERVED_SIZES = [120, 152, 167, 180];

/**
 * A `@docket/brand` module's executable text, with comments removed.
 *
 * @remarks
 * These files document each other at length — the PWA renderer explains that it writes no Apple
 * asset, and the Apple exporter explains that it rasterizes nothing. Scanning the raw text would
 * therefore fail on the prose that asserts the very property being checked. Block comments and
 * whole-line `//` comments are stripped; trailing `//` is left alone so a `https://` inside a
 * string literal survives.
 */
function codeOf(file: string): string {
  return readFileSync(join(BRAND_ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The authored mark, measured from the Icon Composer document's own layer.
 *
 * @remarks
 * Measured rather than pattern-matched. An earlier version of this file parsed the layer with a
 * regex that required `<rect x= y= width= height=>` elements; when the mark became a single
 * `<path>` that regex matched nothing, `Math.min(...[])` returned `Infinity`, and three geometry
 * assertions passed without measuring anything at all. `pathBounds` measures the real artwork,
 * curve extrema included, whatever shape the layer is drawn as.
 */
function markBounds(): Bounds {
  const layer = readFileSync(join(ICON_DOCUMENT, 'Assets/Bars.svg'), 'utf8');
  // Every path, not just the first. Matching once would silently drop any bar drawn in a second
  // element, which is what happened while one bar carried an accent colour: the measured width
  // came out a third short.
  const paths = [...layer.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1] ?? '');
  expect(paths.length, 'the Icon Composer layer contains paths').toBeGreaterThan(0);
  return pathBounds(paths.join(''));
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
    expect(group?.layers.length).toBeGreaterThanOrEqual(1);
  });

  it('draws the same mark @docket/brand renders everywhere else', () => {
    // The layer is generated, so this fails if someone edits `Bars.svg` by hand or forgets to
    // re-export after changing the glyph — which is exactly how the old hand-synchronised copies
    // drifted apart.
    const layer = readFileSync(join(ICON_DOCUMENT, 'Assets/Bars.svg'), 'utf8');
    for (const subpath of markPath(APPLE_CANVAS, APPLE_COVERAGE).bars) {
      expect(layer).toContain(subpath);
    }
  });

  it('is rendered by Apple’s exporter, never by this repository', () => {
    const script = codeOf('src/render-apple.ts');
    expect(script).toContain('Icon Composer.app/Contents/Executables/ictool');
    expect(script).toContain('--export-image');
    // sharp appears only to re-encode ictool's 16-bit output at 8 bits; it must never rasterize,
    // resize or composite, or the shipped asset would stop being Icon Composer's render. Authoring
    // the layer lives in `render-apple-layer.ts` precisely so this file can contain no artwork
    // generation to check for.
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

  it('serves only the Default appearance', () => {
    // Safari hands a home-screen web clip exactly one `apple-touch-icon`, and no Apple platform
    // offers a dark or tinted appearance for one. Shipping another rendition would put artwork
    // nothing can display into the served bundle.
    for (const icon of APPLE_ICONS.filter((entry) => entry.served)) {
      expect(icon.rendition, relative(REPO_ROOT, icon.outPath)).toBe('Default');
    }
  });

  it('keeps every appearance Icon Composer can render as a reviewable master', () => {
    const masters = readdirSync(join(WEB_ROOT, 'design/exports')).sort();
    expect(masters).toEqual([
      'apple-icon-1024-clear-dark.png',
      'apple-icon-1024-clear-light.png',
      'apple-icon-1024-dark.png',
      'apple-icon-1024-tinted-dark.png',
      'apple-icon-1024-tinted-light.png',
      'apple-icon-1024.png',
    ]);
    // Masters are for review and for a future native target; none may leak into the served app.
    for (const icon of APPLE_ICONS.filter((entry) => entry.rendition !== 'Default')) {
      expect(icon.served).toBe(false);
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
    const android = codeOf('src/render-pwa.ts');
    const apple = codeOf('src/render-apple.ts');

    // The Android/Chrome generator is still the only writer of everything the manifest names…
    expect(android).toContain('PWA_ICONS_DIR');
    expect(android).toContain("name: 'icon-192.png'");
    expect(android).not.toContain('apple');
    // …and the Apple exporter writes only Apple assets and its own review masters.
    expect(apple).not.toContain('PWA_ICONS_DIR');
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
    const mark = markBounds();

    // Measured at the time of writing: 869px live area, mark 720x720 → 82.9% on both axes. An
    // earlier version used 800 and measured 92%, which put the bars close enough to the mask that
    // the icon read as cramped — Apple's own icons sit nearer 60–65% of the canvas. The floor is
    // still what "take advantage of the space" asked for: the asset this all replaced used
    // roughly a quarter of the canvas.
    expect(mark.h / live).toBeGreaterThan(0.8);
    expect(mark.w / live).toBeGreaterThan(0.8);
    // …and a ceiling, so nobody quietly grows it back into the mask.
    expect(mark.h / live).toBeLessThan(0.88);
  });

  it('keeps the glyph’s own proportions', () => {
    // The strong statement behind the looser width bound above: the Apple layer is the same shape
    // as every other rendering of the mark, scaled — not a redrawn variant, which is what the two
    // hand-maintained copies used to be.
    const mark = markBounds();
    const web = markPath(32);
    expect(mark.w / mark.h).toBeCloseTo(web.bbox.w / web.bbox.h, 5);
  });

  it('is centred horizontally and optically balanced vertically', () => {
    const mark = markBounds();
    expect(Math.abs(mark.x + mark.w / 2 - APPLE_CANVAS / 2)).toBeLessThanOrEqual(1);

    // Vertically the bounding box is deliberately NOT centred. The bars are top-aligned with
    // descending heights, so their ink sits high inside their box; centring the box leaves the
    // mark's mass above the plate's centre and the icon reads as hanging from the top. The box is
    // pushed down by OPTICAL_SHIFT to close half that gap.
    const boxCentre = mark.y + mark.h / 2;
    expect(boxCentre - APPLE_CANVAS / 2).toBeCloseTo(OPTICAL_SHIFT * mark.h, 0);

    // The check that matters: the shift moves the centre of MASS closer to the plate's centre than
    // the bounding box alone would. Measured off the layer, not asserted from a constant.
    const areas = BAR_HEIGHTS.map((height) => height * BAR_WIDTH);
    const total = areas.reduce((sum, area) => sum + area, 0);
    const centroid =
      mark.y +
      (BAR_HEIGHTS.map((height) => height / 2).reduce(
        (sum, centre, index) => sum + centre * (areas[index] ?? 0),
        0,
      ) /
        total) *
        mark.h;
    const unshifted = centroid - OPTICAL_SHIFT * mark.h;
    expect(Math.abs(centroid - APPLE_CANVAS / 2)).toBeLessThan(
      Math.abs(unshifted - APPLE_CANVAS / 2),
    );
  });

  it('never touches the mask edge', async () => {
    const image = await raster(MASTER);
    const mark = markBounds();
    // The mark is a set of stadium bars, so its bounding-box corners lie outside the drawn
    // artwork — testing them is deliberately stricter than testing the ink itself.
    const corners: readonly (readonly [number, number])[] = [
      [mark.x, mark.y],
      [mark.x + mark.w, mark.y],
      [mark.x, mark.y + mark.h],
      [mark.x + mark.w, mark.y + mark.h],
    ];
    for (const [x, y] of corners) {
      expect(image.opaque(x, y), `corner ${String(x)},${String(y)} inside the mask`).toBe(true);
      // …and with room to spare, so a slightly different mask on a future OS cannot clip it.
      expect(
        image.opaque(x + Math.sign(512 - x) * -16, y + Math.sign(512 - y) * -16),
        `corner ${String(x)},${String(y)} has 16px of clearance`,
      ).toBe(true);
    }
  });
});
