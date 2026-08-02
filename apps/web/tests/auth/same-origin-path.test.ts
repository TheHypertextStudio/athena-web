/**
 * The open-redirect guard, and the agreement between its two bindings.
 *
 * @remarks
 * `safeSameOriginPath` (browser, resolves against `window.location.origin`) and
 * `safeServerReturnPath` (server, resolves against a fixed placeholder) used to be two hand-written
 * copies of the same URL reasoning. They now share one implementation, `sameOriginPath`, and the
 * point of this file is to keep it that way: a `?callbackURL=` that the sign-in *page* accepts on
 * the server and the sign-in *client* rejects after hydration — or the reverse — is a bug in either
 * direction, and it is the kind that only shows up on the route nobody re-checked.
 *
 * So the attack shapes are asserted once, against both bindings, from one table.
 */
import { describe, expect, it } from 'vitest';

import { safeSameOriginPath } from '../../src/components/app-shell-utils';
import { sameOriginPath } from '../../src/lib/same-origin-path';
import { safeServerReturnPath } from '../../src/lib/server-session';

/**
 * Values that must never survive the guard.
 *
 * @remarks
 * Each carries an origin of its own, in one of the forms a browser normalises *before* a
 * hand-rolled `startsWith('/')` check would ever run — which is why the guard compares a parsed
 * origin instead of matching the raw string.
 */
const CROSS_ORIGIN: readonly string[] = [
  'https://evil.example/steal',
  'http://evil.example',
  '//evil.example',
  '//evil.example/path',
  '\\\\evil.example',
  '\\/evil.example',
  'https://user:pass@evil.example/',
];

/** Values that are genuinely same-origin and must be preserved intact. */
const SAME_ORIGIN: readonly (readonly [input: string, expected: string])[] = [
  ['/today', '/today'],
  ['/settings/athena?tab=mcp', '/settings/athena?tab=mcp'],
  ['/tasks#t_1', '/tasks#t_1'],
  ['/orgs/01ABC/projects?view=board#top', '/orgs/01ABC/projects?view=board#top'],
];

describe('sameOriginPath', () => {
  it('keeps a same-origin path with its query and hash', () => {
    for (const [input, expected] of SAME_ORIGIN) {
      expect(sameOriginPath(input, 'https://docket.app')).toBe(expected);
    }
  });

  it('rejects every value that carries an origin of its own', () => {
    for (const value of CROSS_ORIGIN) {
      expect(sameOriginPath(value, 'https://docket.app')).toBeNull();
    }
  });

  it('strips credentials and port from a value that resolves back to the same origin', () => {
    // Same origin, so it survives — but what comes back is a path, never the caller's spelling of
    // the origin. This is what stops an accepted value from smuggling anything into the redirect.
    expect(sameOriginPath('https://docket.app/today?a=1', 'https://docket.app')).toBe('/today?a=1');
  });

  it('answers null for an absent or unparseable value', () => {
    expect(sameOriginPath(null, 'https://docket.app')).toBeNull();
    expect(sameOriginPath(undefined, 'https://docket.app')).toBeNull();
    expect(sameOriginPath('', 'https://docket.app')).toBeNull();
    expect(sameOriginPath('/ok', 'not-an-origin')).toBeNull();
  });
});

describe('the client and server bindings agree', () => {
  it('both reject every cross-origin shape', () => {
    for (const value of CROSS_ORIGIN) {
      expect(safeSameOriginPath(value)).toBeNull();
      expect(safeServerReturnPath(value)).toBeNull();
    }
  });

  it('both preserve the same same-origin paths, byte for byte', () => {
    for (const [input, expected] of SAME_ORIGIN) {
      expect(safeSameOriginPath(input)).toBe(expected);
      expect(safeServerReturnPath(input)).toBe(expected);
    }
  });

  it('both answer null for an absent value', () => {
    for (const value of [null, undefined, '']) {
      expect(safeSameOriginPath(value)).toBeNull();
      expect(safeServerReturnPath(value)).toBeNull();
    }
  });
});
