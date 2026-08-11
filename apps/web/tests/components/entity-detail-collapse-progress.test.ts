import { describe, expect, it } from 'vitest';

import { resolveDetailCollapseProgress } from '@/components/views/entity-detail-collapse';

describe('resolveDetailCollapseProgress', () => {
  it('maps absolute scroll distance to continuous bounded progress', () => {
    expect(resolveDetailCollapseProgress(0, 64, false)).toBe(0);
    expect(resolveDetailCollapseProgress(32, 64, false)).toBe(0.5);
    expect(resolveDetailCollapseProgress(64, 64, false)).toBe(1);
    expect(resolveDetailCollapseProgress(96, 64, false)).toBe(1);
  });

  it('snaps after the first scroll pixel for reduced motion', () => {
    expect(resolveDetailCollapseProgress(0, 64, true)).toBe(0);
    expect(resolveDetailCollapseProgress(1, 64, true)).toBe(1);
  });

  it('keeps malformed geometry at the readable expanded endpoint', () => {
    expect(resolveDetailCollapseProgress(32, 0, false)).toBe(0);
    expect(resolveDetailCollapseProgress(Number.NaN, 64, false)).toBe(0);
  });
});
