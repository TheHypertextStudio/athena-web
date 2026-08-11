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

describe('entity detail collapse contract', () => {
  it('derives covered and coverless geometry in the shared layout', () => {
    expect(layout).toContain("data-detail-cover={cover ? 'present' : 'absent'}");
    expect(layout).toContain('useDetailHeaderCollapse({ hasCover: Boolean(cover) })');
    expect(css).toContain("[data-detail-cover='absent']");
    expect(css).toContain("[data-detail-cover='present']");
    expect(css).toContain('--detail-collapse-range: 4rem');
    expect(css).toContain('--detail-collapse-range: 6rem');
  });

  it('keeps enough stable body geometry for the scroll timeline to finish', () => {
    expect(layout).toContain('detail-body page-bleed page-grid');
    expect(css).toContain('.detail-body');
    expect(css).toContain('container-type: size');
    expect(css).toContain('overflow-anchor: none');
    expect(css).toMatch(/min-block-size:\s*calc\(100cqb/);
    expect(css).toContain('var(--detail-collapse-range)');
  });

  it('morphs one identity from stacked to compact without duplicating the icon', () => {
    expect(layout).toContain('className="detail-identity"');
    expect(layout.match(/className="detail-glyph/g)).toHaveLength(1);
    expect(layout.indexOf('detail-glyph')).toBeLessThan(layout.indexOf('detail-title'));
    expect(css).toContain('padding-block-start: var(--detail-expanded-glyph-row)');
    expect(css).toContain('padding-inline-start: var(--detail-compact-identity-inset)');
    expect(css).toContain('font-size: var(--text-title-medium)');
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
