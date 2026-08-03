/**
 * Unit tests for the public-slug validation and suggestion helpers.
 *
 * @remarks
 * `PublicSlug` and `suggestPublicSlug` are the two places CORE-32's "reserved/system slugs are
 * refused" is actually enforced — one on the way in (validation), one on the way out (the
 * best-effort suggestion offered before validation ever runs).
 */
import { describe, expect, it } from 'vitest';

import { PublicSlug, RESERVED_PUBLIC_SLUGS, suggestPublicSlug } from '../../src/publish';

describe('PublicSlug', () => {
  it('accepts a well-formed, unreserved slug', () => {
    expect(PublicSlug.safeParse('q3-roadmap').success).toBe(true);
  });

  it('refuses a reserved system name even though it matches the slug pattern', () => {
    const result = PublicSlug.safeParse('settings');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected rejection');
    expect(result.error.issues[0]?.path).toEqual([]);
  });
});

describe('suggestPublicSlug', () => {
  it('slugifies a title into lowercase, hyphen-separated words', () => {
    expect(suggestPublicSlug('Q3 — Payments Reliability!')).toBe('q3-payments-reliability');
  });

  it('returns an empty string when the title has no slug-able characters', () => {
    expect(suggestPublicSlug('🚀🚀🚀')).toBe('');
  });

  it('returns an empty string rather than a reserved system name', () => {
    // A title that happens to slugify to a reserved word must not silently hand back a name the
    // caller cannot actually claim.
    expect(RESERVED_PUBLIC_SLUGS).toContain('settings');
    expect(suggestPublicSlug('Settings')).toBe('');
  });
});
