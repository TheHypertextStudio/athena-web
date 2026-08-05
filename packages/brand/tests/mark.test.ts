import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APPLE_CANVAS,
  APPLE_COVERAGE,
  barSubpaths,
  COVERAGE,
  GAP_RATIO,
  GLYPH,
  markPath,
  pathBounds,
} from '../src/mark';
import { bareMarkSvg, CANVAS, opaqueMarkSvg, themedMarkSvg } from '../src/svg';

/**
 * The mark's geometry, checked against the thing it is derived from rather than against numbers
 * restated here.
 *
 * @remarks
 * Two properties are worth more than the rest. The first is provenance: the path is a copy of an
 * upstream glyph, and a copy that nobody checks is a fork. The second is the 16px legibility
 * floor, which is the only reason {@link GAP_RATIO} is 0.5 rather than something tighter — without
 * a test, the next person to want "more cohesion" lowers it and the bars silently merge in the
 * browser tab.
 */

const require = createRequire(import.meta.url);

describe('provenance', () => {
  it('quotes the installed Material glyph exactly', () => {
    // Resolved from the package root rather than by subpath: the package's `exports` map rewrites
    // a bare specifier and lands on `ViewKanbanRounded.js.js`.
    const root = dirname(require.resolve('@mui/icons-material/package.json'));
    const source = readFileSync(join(root, `${GLYPH.module}.js`), 'utf8');
    const upstream = /d:\s*"([^"]+)"/.exec(source)?.[1];
    expect(upstream, 'ViewKanbanRounded.js exposes a path').toBeTruthy();
    // If Material redraws the icon, this fails and somebody decides whether Docket follows —
    // rather than the two quietly diverging.
    expect(GLYPH.d).toBe(upstream);
  });

  it('takes the three bars and leaves the frame behind', () => {
    const bars = barSubpaths();
    expect(bars).toHaveLength(3);
    // The frame's own subpath spans the full 24-unit box; no bar may.
    for (const bar of bars) {
      expect(pathBounds(bar).w).toBeLessThan(GLYPH.viewBox / 2);
    }
  });

  it('is drawn from bars of one uniform width', () => {
    // The pitch calculation assumes it. Compared with a tolerance because the widths come from
    // solving bezier extrema, which lands on 2.0000000000000036 rather than 2.
    const widths = barSubpaths().map((bar) => pathBounds(bar).w);
    for (const width of widths) {
      expect(width).toBeCloseTo(widths[0] ?? 0, 9);
    }
  });
});

describe('layout', () => {
  it('spans the requested fraction of the canvas on its longer axis', () => {
    const mark = markPath(CANVAS);
    expect(Math.max(mark.bbox.w, mark.bbox.h) / CANVAS).toBeCloseTo(COVERAGE, 10);
  });

  it('is taller than it is wide, and keeps that ratio at every size', () => {
    const small = markPath(16);
    const large = markPath(APPLE_CANVAS);
    expect(small.bbox.h).toBeGreaterThan(small.bbox.w);
    expect(small.bbox.w / small.bbox.h).toBeCloseTo(large.bbox.w / large.bbox.h, 10);
  });

  it('centres the ink, not the glyph’s nominal box', () => {
    // Material's 24-unit box carries empty margin. Centring on it rather than on the measured
    // artwork would leave the mark sitting low and left on the plate.
    const mark = markPath(CANVAS);
    expect(mark.bbox.x + mark.bbox.w / 2).toBeCloseTo(CANVAS / 2, 10);
    expect(mark.bbox.y + mark.bbox.h / 2).toBeCloseTo(CANVAS / 2, 10);
  });

  it('spaces the bars at the declared fraction of their width', () => {
    const mark = markPath(CANVAS);
    expect(mark.gap / mark.barWidth).toBeCloseTo(GAP_RATIO, 10);
  });

  it('puts the bars on an even pitch', () => {
    const mark = markPath(CANVAS);
    const lefts = mark.d
      .split(/(?=M)/)
      .filter(Boolean)
      .map((bar) => pathBounds(bar).x);
    expect(lefts).toHaveLength(3);
    const pitches = lefts.slice(1).map((left, index) => left - (lefts[index] ?? 0));
    expect(pitches[0]).toBeCloseTo(pitches[1] ?? 0, 6);
    expect(pitches[0]).toBeCloseTo(mark.barWidth + mark.gap, 6);
  });

  it('keeps a whole device pixel between bars at the smallest favicon', () => {
    // The reason GAP_RATIO is 0.5. Below one pixel the three bars render as a grey smear, and a
    // 16px favicon is the size at which that first happens.
    expect(markPath(16).gap).toBeGreaterThanOrEqual(1);
  });

  it('scales the Apple layer to the same height the outgoing asset used', () => {
    // 800px of the 1024px grid — 92% of the 869px live area Apple's mask leaves. Held constant so
    // this change is about the glyph, not about the size.
    expect(markPath(APPLE_CANVAS, APPLE_COVERAGE).bbox.h).toBeCloseTo(800, 6);
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

  it('gives the Apple layer no plate of its own', () => {
    // Apple's plate is the gradient in `icon.json`, and `IconRendering` applies the glass around
    // it. A rect here would sit as a flat slab underneath the material.
    const layer = bareMarkSvg(APPLE_CANVAS, APPLE_COVERAGE);
    expect(layer).not.toContain('<rect');
    expect(layer).not.toContain('#1C1C1F');
  });

  it('renders one path per document, from the same geometry', () => {
    const { d } = markPath(CANVAS);
    expect(themedMarkSvg()).toContain(d);
    expect(themedMarkSvg(28)).toContain(d);
  });
});
