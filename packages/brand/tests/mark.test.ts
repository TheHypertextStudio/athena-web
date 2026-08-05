import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inGamut, oklchToHex, parseOklch } from '../src/color';
import {
  ACCENT,
  ACCENT_BAR,
  ACCENT_TOKEN,
  APPLE_CANVAS,
  APPLE_COVERAGE,
  BAR_GAP,
  BAR_HEIGHTS,
  BAR_WIDTH,
  COVERAGE,
  markPath,
  MIN_FAVICON,
  pathBounds,
  plateRadius,
} from '../src/mark';
import { REPO_ROOT } from '../src/paths';
import { bareMarkSvg, CANVAS, opaqueMarkSvg, themedMarkSvg } from '../src/svg';

/**
 * The mark's geometry, checked against the constraints it was solved from rather than against
 * numbers restated here.
 *
 * @remarks
 * Three properties carry the design and everything else follows from them: the corners are
 * concentric, the gap survives a 16px favicon, and the accent equals the design token. Each is
 * asserted directly, so loosening any one of them fails loudly instead of degrading the icon
 * quietly.
 */

describe('concentric corners', () => {
  it('centres the plate’s corner arc on the bars’ cap arcs', () => {
    // The governing constraint. The plate's top-left arc is centred at (R, R); the left bar's top
    // cap is centred at (margin + r, margin + r). Concentric means those are the same point.
    for (const canvas of [16, 32, 180, 512]) {
      const { margin, capRadius } = markPath(canvas);
      expect(plateRadius(canvas), `canvas ${String(canvas)}`).toBeCloseTo(margin + capRadius, 10);
    }
  });

  it('keeps the mark square, which is what makes one radius possible', () => {
    // With unequal margins the cap centre is at (margin_x + r, margin_y + r), which no single
    // plate radius can meet on both axes.
    for (const canvas of [16, 32, APPLE_CANVAS]) {
      const { bbox } = markPath(canvas);
      expect(bbox.w, `canvas ${String(canvas)}`).toBeCloseTo(bbox.h, 10);
    }
  });

  it('solves the bar width and gap from that squareness', () => {
    // Three bars and two gaps span exactly the mark's side…
    expect(BAR_HEIGHTS.length * BAR_WIDTH + (BAR_HEIGHTS.length - 1) * BAR_GAP).toBeCloseTo(1, 12);
    // …at the 8:3 bar-to-gap ratio chosen in review, which is what fixes them at 4/15 and 1/10.
    expect(BAR_WIDTH / BAR_GAP).toBeCloseTo(8 / 3, 12);
  });

  it('measures the drawn artwork, not the numbers that produced it', () => {
    // pathBounds reads the emitted arcs back. If the stadium caps were malformed — wrong sweep,
    // wrong radius — the measured box would not match the computed one.
    const { d, bbox } = markPath(CANVAS);
    const measured = pathBounds(d);
    expect(measured.x).toBeCloseTo(bbox.x, 2);
    expect(measured.y).toBeCloseTo(bbox.y, 2);
    expect(measured.w).toBeCloseTo(bbox.w, 2);
    expect(measured.h).toBeCloseTo(bbox.h, 2);
  });
});

describe('layout', () => {
  it('derives the web coverage from the 16px legibility floor', () => {
    // Below one device pixel the gap antialiases into a grey smear and the three bars read as one
    // blob. COVERAGE is the solution of that inequality at equality, so this lands on exactly 1.
    expect(markPath(MIN_FAVICON).gap).toBeCloseTo(1, 12);
    expect(COVERAGE).toBeCloseTo(1 / (BAR_GAP * MIN_FAVICON), 12);
  });

  it('descends tall, short, medium', () => {
    const { bars } = markPath(CANVAS);
    const heights = bars.map((subpath) => pathBounds(subpath).h);
    expect(heights[0]).toBeGreaterThan(heights[2] ?? 0);
    expect(heights[2]).toBeGreaterThan(heights[1] ?? 0);
  });

  it('top-aligns every bar', () => {
    const { bars, bbox } = markPath(CANVAS);
    for (const subpath of bars) {
      expect(pathBounds(subpath).y).toBeCloseTo(bbox.y, 2);
    }
  });

  it('scales the Apple layer to the height the outgoing asset used', () => {
    // 800px of the 1024px grid — 92% of the 869px live area Apple's mask leaves.
    const { bbox } = markPath(APPLE_CANVAS, APPLE_COVERAGE);
    expect(bbox.h).toBeCloseTo(800, 6);
    expect(bbox.w).toBeCloseTo(800, 6);
  });
});

describe('the accent', () => {
  it('equals the --primary design token, converted rather than pasted', () => {
    const css = readFileSync(join(REPO_ROOT, 'packages/ui/src/styles/globals.css'), 'utf8');
    // The first `--primary:` declaration is the light-scheme one; the dark override comes later
    // inside a media query.
    const declared = /--primary:\s*(oklch\([^)]*\))/.exec(css)?.[1];
    expect(declared, '--primary is declared in globals.css').toBeTruthy();
    expect(declared).toBe(ACCENT_TOKEN.oklch);

    const { lightness, chroma, hue } = parseOklch(declared ?? '');
    // Changing the token without re-running `pnpm icons` fails here rather than leaving the icon
    // quietly off-brand.
    expect(ACCENT).toBe(oklchToHex(lightness, chroma, hue));
  });

  it('converts OKLCH correctly at the anchors', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#FFFFFF');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    // A neutral mid-grey: Oklab lightness 0.5 is well below sRGB's 50%.
    expect(oklchToHex(0.5, 0, 0)).toBe('#636363');
  });

  it('produces a colour sRGB can actually show', () => {
    const { lightness, chroma, hue } = parseOklch(ACCENT_TOKEN.oklch);
    expect(chroma).toBeGreaterThan(0);
    // Round-tripping the hex must not have needed clamping, or the icon would not match the token.
    const hex = oklchToHex(lightness, chroma, hue);
    const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    expect(inGamut({ r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0 })).toBe(true);
  });

  it('rejects a token shape it would otherwise misread', () => {
    expect(() => parseOklch('oklch(0.52 0.21 264 / 50%)')).toThrow(/Not an oklch/);
    expect(() => parseOklch('var(--primary)')).toThrow(/Not an oklch/);
  });

  it('paints the last bar and only the last bar', () => {
    const svg = themedMarkSvg();
    const { bars } = markPath(CANVAS);
    expect(ACCENT_BAR).toBe(bars.length - 1);
    expect(svg).toContain(`<path fill="${ACCENT}" d="${bars[ACCENT_BAR] ?? ''}"`);
    for (const [index, subpath] of bars.entries()) {
      if (index !== ACCENT_BAR) {
        expect(svg).not.toContain(`fill="${ACCENT}" d="${subpath}"`);
      }
    }
  });
});

describe('the documents built from it', () => {
  it('makes the plate the default and its removal the override', () => {
    // Safari renders SVG favicons but ignores their media queries. Whichever branch is the default
    // is the one Safari shows, so the plate has to be it.
    const svg = themedMarkSvg();
    const plateDefault = svg.indexOf('.plate { fill: #1C1C1F }');
    const darkOverride = svg.indexOf('@media (prefers-color-scheme: dark)');
    expect(plateDefault).toBeGreaterThan(-1);
    expect(darkOverride).toBeGreaterThan(plateDefault);
    expect(svg).toContain('.plate { fill: none }');
  });

  it('never puts a media query in a document that gets rasterized', () => {
    // An installed icon is one fixed image. If the PWA renderer read the themed favicon instead,
    // the committed PNG would depend on how a rasterizer treats a query it cannot evaluate.
    expect(opaqueMarkSvg(512)).not.toContain('prefers-color-scheme');
    expect(opaqueMarkSvg(512)).toContain('fill="#1C1C1F"');
  });

  it('gives every plate the concentric radius', () => {
    expect(themedMarkSvg()).toContain(`rx="${Number(plateRadius(CANVAS).toFixed(3)).toString()}"`);
    expect(opaqueMarkSvg(512)).toContain(`rx="${Number(plateRadius(512).toFixed(3)).toString()}"`);
  });

  it('gives the Apple layer no plate of its own', () => {
    // Apple's plate is the gradient in `icon.json`, and `IconRendering` applies the glass around
    // it. A rect here would sit as a flat slab underneath the material.
    const layer = bareMarkSvg(APPLE_CANVAS, APPLE_COVERAGE);
    expect(layer).not.toContain('<rect');
    expect(layer).not.toContain('#1C1C1F');
    expect(layer).toContain(ACCENT);
  });
});
