import { describe, expect, it } from 'vitest';

import { getOrgAccent, ORG_ACCENT_PALETTE } from './org-accent';
import { cn } from './utils';

describe('cn', () => {
  it('joins truthy class names and drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('de-duplicates conflicting Tailwind utilities, keeping the last', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('returns an empty string for no inputs', () => {
    expect(cn()).toBe('');
  });
});

describe('getOrgAccent', () => {
  it('returns a palette entry for an org id', () => {
    const accent = getOrgAccent('ORG00000000000000000000001');
    expect(ORG_ACCENT_PALETTE).toContain(accent);
  });

  it('is deterministic for the same id', () => {
    expect(getOrgAccent('same-id')).toBe(getOrgAccent('same-id'));
  });

  it('distributes ids across the whole palette', () => {
    const seen = new Set<string>();
    // FNV-1a over many distinct ids should hit every palette bucket.
    for (let i = 0; i < 500; i++) {
      seen.add(getOrgAccent(`org-${String(i)}`));
    }
    expect(seen.size).toBe(ORG_ACCENT_PALETTE.length);
  });

  it('returns a valid palette color for the empty string', () => {
    // `% palette.length` always selects a real entry; the undefined-guard is unreachable.
    const accent = getOrgAccent('');
    expect(ORG_ACCENT_PALETTE).toContain(accent);
  });
});
