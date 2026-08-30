import { describe, expect, it } from 'vitest';

import { tagListMatches } from '../../src/lib/preconditions';

describe('tagListMatches', () => {
  it('matches a listed tag, ignoring the weak-validator prefix', () => {
    expect(tagListMatches('"a", W/"b"', '"b"')).toBe(true);
  });

  it('rejects a tag that is not in the list', () => {
    expect(tagListMatches('"a", "b"', '"c"')).toBe(false);
  });

  it('treats a bare "*" as matching any existing representation', () => {
    // Every existing caller sent a real tag list, so the wildcard early-return — the one `If-Match`
    // asserts "any current version is fine" rather than naming one — was never exercised.
    expect(tagListMatches('*', '"anything"')).toBe(true);
  });
});
