import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inGamut, oklchToHex, parseOklch } from '../src/color';
import {
  APPLE_CANVAS,
  APPLE_COVERAGE,
  BAR_GAP,
  BAR_HEIGHTS,
  BAR_WIDTH,
  COVERAGE,
  INK,
  markPath,
  MIN_FAVICON,
  OPTICAL_CORRECTION,
  OPTICAL_SHIFT,
  pathBounds,
  PLATE,
  plateRadius,
  PLATE_TOKEN,
} from '../src/mark';
import { REPO_ROOT } from '../src/paths';
import { bareMarkSvg, CANVAS, faviconSvg, platedMarkSvg } from '../src/svg';

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
    // …at 3:1, the bar-to-gap ratio nearest the 8:3 review picked that also lands on whole units.
    expect(BAR_WIDTH / BAR_GAP).toBeCloseTo(3, 12);
  });

  it('puts every dimension on a whole unit at every size that is drawn', () => {
    // Fractional widths are a smell in artwork that gets rasterized: an exporter has to resolve
    // 5.333, and it resolves it differently at different sizes. Elevenths avoid the question.
    // 16 is excluded on purpose — its mark side is 11, an odd number, so the margin is a half.
    for (const [canvas, coverage] of [
      [CANVAS, COVERAGE],
      [192, COVERAGE],
      [512, COVERAGE],
      [APPLE_CANVAS, APPLE_COVERAGE],
    ] as const) {
      const mark = markPath(canvas, coverage);
      const whole = [
        mark.bbox.w,
        mark.bbox.x,
        mark.bbox.y,
        mark.barWidth,
        mark.gap,
        mark.margin,
        mark.capRadius,
        plateRadius(canvas, coverage),
        ...BAR_HEIGHTS.map((ratio) => ratio * mark.bbox.h),
      ];
      for (const value of whole) {
        expect(value, `canvas ${String(canvas)}: ${String(value)}`).toBeCloseTo(
          Math.round(value),
          9,
        );
      }
    }
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

  it('leaves the Apple mark room inside the grid', () => {
    // 726px of the 1024px grid — 84% of the 869px live area Apple's mask leaves, and 71% of the
    // canvas. 726 is 720 rounded to a multiple of 11 so the bars come out at 198 rather than a
    // repeating decimal. The outgoing asset used 800, which put the bars close enough to the mask
    // that the icon read as cramped.
    const { bbox } = markPath(APPLE_CANVAS, APPLE_COVERAGE);
    expect(bbox.h).toBeCloseTo(726, 6);
    expect(bbox.w).toBeCloseTo(726, 6);
    expect(bbox.h / APPLE_CANVAS).toBeLessThan(0.75);
  });

  it('corrects half the optical offset, not all of it', () => {
    // Full correction puts the centre of mass on the plate's centre and reads as sitting on the
    // bottom: the eye anchors on the bars' shared top edge. None of it reads as hanging from the
    // top. The assertion pins the halfway point so neither drift is silent.
    const areas = BAR_HEIGHTS.map((height) => height * BAR_WIDTH);
    const total = areas.reduce((sum, area) => sum + area, 0);
    const centroid =
      BAR_HEIGHTS.map((height) => height / 2).reduce(
        (sum, centre, index) => sum + centre * (areas[index] ?? 0),
        0,
      ) / total;
    expect(OPTICAL_SHIFT).toBeCloseTo(OPTICAL_CORRECTION * (0.5 - centroid), 12);
    // Pinned to the integer grid at 1/22, which closes 0.587 of the gap rather than 0.500. Both
    // ends of the range the ictool renders were compared over.
    expect(OPTICAL_CORRECTION).toBeGreaterThan(0.4);
    expect(OPTICAL_CORRECTION).toBeLessThan(0.7);
  });

  it('sits the mark below its bounding box centre by exactly that shift', () => {
    const canvas = APPLE_CANVAS;
    const { bbox, margin } = markPath(canvas, APPLE_COVERAGE);
    expect(bbox.y - margin).toBeCloseTo(OPTICAL_SHIFT * bbox.h, 6);
    // Still inside the canvas with room underneath, or the mask would clip the tall bar.
    expect(canvas - (bbox.y + bbox.h)).toBeGreaterThan(0.08 * canvas);
  });
});

describe('the plate colour', () => {
  it('equals the --primary design token, converted rather than pasted', () => {
    const css = readFileSync(join(REPO_ROOT, 'packages/ui/src/styles/globals.css'), 'utf8');
    // The first `--primary:` declaration is the light-scheme one; the dark override comes later
    // inside a media query.
    const declared = /--primary:\s*(oklch\([^)]*\))/.exec(css)?.[1];
    expect(declared, '--primary is declared in globals.css').toBeTruthy();
    expect(declared).toBe(PLATE_TOKEN.oklch);

    const { lightness, chroma, hue } = parseOklch(declared ?? '');
    // Changing the token without re-running `pnpm icons` fails here rather than leaving the icon
    // quietly off-brand.
    expect(PLATE).toBe(oklchToHex(lightness, chroma, hue));
  });

  it('converts OKLCH correctly at the anchors', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#FFFFFF');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    // A neutral mid-grey: Oklab lightness 0.5 is well below sRGB's 50%.
    expect(oklchToHex(0.5, 0, 0)).toBe('#636363');
  });

  it('produces a colour sRGB can actually show', () => {
    const { lightness, chroma, hue } = parseOklch(PLATE_TOKEN.oklch);
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

  it('keeps every bar white, so the brand colour is the plate and not one stripe', () => {
    // An accent bar in --primary against the old near-black plate read muddy, and the specular
    // edge made it worse. Moving the colour to the plate is what let the bars stay legible.
    const svg = faviconSvg();
    expect(svg).toContain(`fill="${PLATE}"`);
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
    expect(svg).toContain(`<path fill="${INK}"`);
  });
});

describe('the documents built from it', () => {
  it('carries no colour-scheme branch on any surface', () => {
    // The plate was near-black once and vanished into a dark tab strip, so it was dropped under a
    // dark-mode media query. An indigo plate has an edge against light and dark chrome alike, so
    // that branch would now be dropping the brand colour to solve a problem that no longer exists.
    for (const svg of [faviconSvg(), faviconSvg(28), platedMarkSvg(512)]) {
      expect(svg).not.toContain('prefers-color-scheme');
      expect(svg).not.toContain('<style');
    }
  });

  it('draws the favicon and the offline page from one document', () => {
    // Same coordinate space at two display sizes, so the two can only differ in width and height.
    expect(faviconSvg(28).replace(/(width|height)="28"/g, '$1="32"')).toBe(faviconSvg());
  });

  it('gives every plate the concentric radius', () => {
    expect(faviconSvg()).toContain(`rx="${Number(plateRadius(CANVAS).toFixed(3)).toString()}"`);
    expect(platedMarkSvg(512)).toContain(`rx="${Number(plateRadius(512).toFixed(3)).toString()}"`);
  });

  it('gives the Apple layer no plate of its own', () => {
    // Apple's plate is the gradient in `icon.json`, and `IconRendering` applies the glass around
    // it. A rect here would sit as a flat slab underneath the material.
    const layer = bareMarkSvg(APPLE_CANVAS, APPLE_COVERAGE);
    expect(layer).not.toContain('<rect');
    expect(layer).not.toContain(PLATE);
    expect(layer).toContain(INK);
  });
});
