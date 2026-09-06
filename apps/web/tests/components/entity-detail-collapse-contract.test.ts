import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const layout = readFileSync(
  join(root, 'apps/web/src/components/views/entity-detail-layout.tsx'),
  'utf8',
);
const collapseBehavior = readFileSync(
  join(root, 'apps/web/src/components/views/entity-detail-collapse.ts'),
  'utf8',
);
const css = readFileSync(join(root, 'packages/ui/src/styles/globals.css'), 'utf8');

function literalClassToken(token: string): RegExp {
  return new RegExp(`className="[^"]*\\b${token}\\b[^"]*"`, 'g');
}

describe('entity detail collapse contract', () => {
  it('derives covered and coverless geometry in the shared layout', () => {
    expect(layout).toContain("data-detail-cover={cover ? 'present' : 'absent'}");
    expect(layout).toContain('useDetailHeaderCollapse({ hasCover: Boolean(cover) })');
    expect(css).toContain("[data-detail-cover='absent']");
    expect(css).toContain("[data-detail-cover='present']");
    expect(css).toContain('--detail-collapse-range: 4rem');
    expect(css).toContain('--detail-collapse-range: 6rem');
  });

  it('keeps collapse geometry on the shared detail scroll owner', () => {
    expect(layout).toContain('detail-body page-bleed page-grid');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('overflow-anchor: none');
    expect(css).toContain("[data-detail-cover='present']");
    expect(css).toContain('--detail-collapse-range: 6rem');
  });

  it('morphs one identity from stacked to compact without duplicating the icon', () => {
    expect(layout).toMatch(literalClassToken('detail-identity'));
    expect(layout).toMatch(literalClassToken('detail-primary'));
    expect(layout).toMatch(literalClassToken('detail-masthead'));
    expect(layout).toMatch(literalClassToken('detail-tabs'));
    expect(layout.match(literalClassToken('detail-glyph'))).toHaveLength(1);
    expect(layout.indexOf('detail-glyph')).toBeLessThan(layout.indexOf('detail-title'));
    expect(css).toMatch(
      /\.detail-primary\s*\{[\s\S]*\[identity\] var\(--detail-expanded-glyph-size\)/,
    );
    expect(css).toContain('padding-inline-start: var(--detail-compact-identity-inset)');
    expect(css).toContain('font-size: var(--text-title-medium)');
    expect(css).toContain('--detail-expanded-glyph-size: 3rem');
    expect(css).toMatch(/@keyframes detail-glyph-collapse[\s\S]*scale\(0\.833333\)/);
    // `left top`, not `left center`: centering the scale on the glyph's own (fixed 48px) box let
    // the shrunk glyph's visual bottom edge outrun `.detail-identity`'s real, shrunk-below-48px
    // height at full collapse — a few px past the row, and once the cover started ending exactly
    // at that row's edge, past the cover too. Top-left anchoring keeps the glyph's top pinned to
    // the row's top the whole time, so it only ever shrinks inward, never past a boundary the row
    // has already shrunk to.
    expect(css).toMatch(/\.detail-glyph\s*\{[^}]*transform-origin:\s*left top/);
  });

  it('keeps masthead actions in the compact identity row without making the masthead an object surface', () => {
    expect(layout).not.toContain('<ObjectSurface');
    expect(layout).toMatch(/detail-primary[\s\S]*detail-identity[\s\S]*detail-actions/);
    expect(css).toMatch(
      /\.detail-primary\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/,
    );
    expect(css).toMatch(/\.detail-primary\s*\{[^}]*align-items:\s*start/);
    expect(css).toMatch(/\.detail-actions\s*\{[^}]*align-self:\s*start/);
  });

  it('keeps expanded text readable and restores spacing that collapses with the masthead', () => {
    expect(css).toContain('--detail-compact-identity-inset: 3rem');
    expect(css).toContain('animation-name: detail-masthead-collapse');
    expect(css).toMatch(/@keyframes detail-masthead-collapse[\s\S]*row-gap:\s*0/);
    expect(layout).toContain("'detail-header page-bleed");
    // `padding-block-start` moved off `.detail-header` onto `.masthead-content` — a sibling of the
    // cover rather than an ancestor of it, so the cover's `inset-0` against `.masthead-band` isn't
    // pushed down by the same padding that indents the eyebrow/title text.
    expect(layout).toMatch(literalClassToken('masthead-content'));
    expect(css).not.toMatch(/\.detail-header\s*\{[^}]*padding-block-start/);
    expect(css).toMatch(
      /@keyframes detail-title-collapse\s*\{[\s\S]*from\s*\{[\s\S]*white-space:\s*normal/,
    );
  });

  it('measures the page inset once, so the top edge matches the sides at every gutter step', () => {
    // The horizontal inset is the `.page-grid` gutter track, which steps 12 → 24 → 32px with the
    // pane. Every vertical inset used to be a separate frozen literal, so the top of a collapsed
    // page sat 4px from its own edge and 32px from its sides. They read the gutter now.
    expect(css).toMatch(
      /\.masthead-content\s*\{[\s\S]*padding-block-start:\s*var\(--page-gutter\)/,
    );
    // The gap between the title row and its own tab bar is deliberately NOT gutter-derived. It is
    // rhythm inside one band, not an inset from the pane's edge; deriving it put a full 32px there
    // at a normal width, which read as the header having come apart. Equal halves either side of
    // the cover boundary so that boundary stays centred.
    expect(css).toMatch(/\.masthead-content\s*\{[\s\S]*padding-block-end:\s*0\.5rem/);
    expect(css).toMatch(/\.detail-tabs\s*\{[^}]*margin-block-start:\s*0\.5rem/);
    expect(css).toMatch(
      /\.detail-body\s*\{[^}]*padding-block-end:\s*max\(var\(--page-gutter\), env\(safe-area-inset-bottom\)\)/,
    );
    // The bottom inset cannot live on the scroller: it declares its own `container-type`, and an
    // element is never its own query container, so it only ever sees the unstepped 12px gutter.
    expect(layout).toContain(
      "'page-grid h-full min-h-0 w-full gap-y-4 overflow-y-auto @2xl:gap-y-5'",
    );
  });

  it('spends no page inset on collapsing the header', () => {
    expect(css).not.toContain('detail-masthead-content-collapse');
    expect(css).not.toContain('detail-tabs-collapse');
    expect(css).not.toMatch(/\.masthead-content\s*\{[^}]*animation-name/);
    expect(css).not.toMatch(/\.detail-tabs\s*\{[^}]*animation-name/);
    // The range those two used to cover is still carried by the rows that should carry it.
    expect(css).toContain('animation-name: detail-primary-collapse');
    expect(css).toContain('animation-name: detail-secondary-collapse');
    expect(css).toContain('animation-name: detail-masthead-collapse');
  });

  it('separates the header from the content behind it by tone, not by a rule or a shadow', () => {
    // M3's scrolled top app bar: flush with the page at rest, lifted once content is underneath it,
    // interpolated on the same progress as the collapse so the two read as one motion. A hairline
    // is not the house style and a shadow is reserved for overlay primitives.
    //
    // Neither endpoint is a token here. The stylesheet consumes two custom properties, and the
    // layout sets them from `surfaceToneVariable` — so the ramp step is chosen by role next to the
    // other role names rather than typed into a stylesheet that no lint rule reads. The
    // design-token policy holds the CSS side of that line.
    expect(css).toMatch(/\.detail-header\s*\{[^}]*background-color:\s*var\(--detail-bar-resting\)/);
    expect(css).toMatch(/\.detail-header\s*\{[^}]*animation-name:\s*detail-header-lift/);
    expect(css).toMatch(
      /@keyframes detail-header-lift[\s\S]*background-color:\s*var\(--detail-bar-lifted\)/,
    );
    // `page` at rest, `floating` lifted. Not the `card` `AppBar` takes: this bar occludes an
    // `EntityDocument` body, which is itself `card`, so a `card` bar and the panel sliding under it
    // are one tone and the boundary disappears. A bar out-ranks the furniture it covers.
    expect(layout).toContain("surfaceToneVariable('page')");
    expect(layout).toContain("surfaceToneVariable('floating')");
    // The fill belongs to that rule alone; a `bg-*` utility on the element would win by source
    // order and freeze the bar at one tone.
    expect(layout).not.toMatch(/detail-header[^"]*\bbg-/);
    expect(layout).not.toContain('<Separator');
  });

  it('keeps anchor targets clear of the sticky header', () => {
    expect(collapseBehavior).toContain('--detail-header-height');
    expect(collapseBehavior).toContain('new ResizeObserver');
    expect(css).toMatch(
      /\[data-detail-panel-scroll\]\s*\{[^}]*scroll-padding-block-start:\s*calc\(var\(--detail-header-height, 0px\) \+ 1rem\)/,
    );
  });

  it('keeps the tab strip flush with no wrapper padding', () => {
    expect(css).not.toMatch(/\.detail-header\s*\{[^}]*padding-block-end/);
    expect(css).not.toMatch(/\.detail-tabs\s*\{[^}]*padding-block/);
    expect(css).not.toContain('detail-header-collapse');
  });

  it('uses a discrete compact state for reduced motion', () => {
    expect(collapseBehavior).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(collapseBehavior).toContain(
      "addEventListener('scroll', queueProgress, { passive: true })",
    );
    expect(css).toContain('--detail-collapse-progress: 0');
    expect(css).toContain('animation-delay: var(--detail-collapse-delay)');
    expect(css).toContain('animation-play-state: paused');
    expect(css).not.toContain('animation-timeline: scroll(nearest)');
  });
});
