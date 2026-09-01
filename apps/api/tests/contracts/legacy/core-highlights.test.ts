import { describe, expect, it } from 'vitest';

import { joinLabels, sourceLabel } from '../../../src/contracts/highlights';

describe('sourceLabel', () => {
  it('gives a source the name the product uses for it', () => {
    // Application-owned copy: `google_calendar` is a column value, "Calendar" is what a person calls
    // the thing. The panel and the digest email both go through this, so they cannot disagree.
    expect(sourceLabel('google_calendar')).toBe('Calendar');
    expect(sourceLabel('github')).toBe('GitHub');
    expect(sourceLabel('gmail')).toBe('Gmail');
  });

  it('falls back to a readable form for a source with no label yet', () => {
    // A new `source_system` value must not render as a raw identifier with an underscore in it, and
    // must not throw. The fallback is deliberately dull rather than clever.
    expect(sourceLabel('google_drive')).toBe('Drive');
    // Cast: the point is the branch taken by a value that has no entry, which by construction cannot
    // be named here without adding one.
    expect(sourceLabel('brand_new_source' as 'github')).toBe('brand new source');
  });
});

describe('joinLabels', () => {
  it('reads as a sentence at every length', () => {
    expect(joinLabels([])).toBe('');
    expect(joinLabels(['Gmail'])).toBe('Gmail');
    expect(joinLabels(['Gmail', 'GitHub'])).toBe('Gmail and GitHub');
    expect(joinLabels(['Gmail', 'GitHub', 'Calendar'])).toBe('Gmail, GitHub and Calendar');
  });
});
