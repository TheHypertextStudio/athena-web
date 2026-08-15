/**
 * `@docket/web` — the CSP covers every app route and stops at the documentation subpath.
 *
 * @remarks
 * The exclusion is a negative lookahead in a path-to-regexp pattern, which can read correct and
 * match nothing. A silent failure there costs the whole product its CSP.
 *
 * Compiled from the real `headers()` output with Next's own `getPathMatch`, so a CSP attached to
 * the wrong source fails too. The `vi.hoisted()` env stub follows
 * `canonical-host-redirect.test.ts`; `next.config.ts` throws without `API_URL`.
 */
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['API_URL'] = 'https://docket-api.hypertext.studio';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://docket.hypertext.studio';
});

import nextConfig from '../../next.config';

/** Whether the rule carrying the CSP applies to `pathname`. */
async function cspCovers(pathname: string): Promise<boolean> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const csp = rules.filter((rule) =>
    rule.headers.some((header) => header.key === 'Content-Security-Policy'),
  );
  // Exactly one rule may carry it. Two would intersect into a policy nobody wrote down.
  expect(csp).toHaveLength(1);
  return getPathMatch(csp[0]?.source ?? '', { removeUnnamedParams: true })(pathname) !== false;
}

describe('app CSP route coverage', () => {
  it.each([
    ['/', 'the marketing home page'],
    ['/pricing', 'a marketing page'],
    ['/oauth/authorize', 'the consent screen the framing directive exists for'],
    ['/settings/security', 'a nested app route'],
    ['/sw.js', 'a static asset'],
    ['/documentation', 'a sibling route that merely starts with "docs"'],
    ['/docsy', 'a sibling route that merely starts with "docs"'],
  ])('covers %s (%s)', async (pathname) => {
    await expect(cspCovers(pathname)).resolves.toBe(true);
  });

  it.each([
    ['/docs', 'the documentation root'],
    ['/docs/guides/what-docket-is', 'a documentation page'],
    ['/docs/developers/errors', 'a nested documentation page'],
  ])('leaves %s to Mintlify (%s)', async (pathname) => {
    await expect(cspCovers(pathname)).resolves.toBe(false);
  });

  it('still covers the Mintlify asset paths', async () => {
    // A CSP on a script or font response is inert; only the document's policy governs loading.
    await expect(cspCovers('/_mintlify/chunk.js')).resolves.toBe(true);
    await expect(cspCovers('/mintlify-assets/fonts/a.woff2')).resolves.toBe(true);
  });

  it('keeps the framing protections on the documentation subpath', async () => {
    // `X-Frame-Options` rides a separate rule matching every route, so excluding the CSP is safe.
    const rules = (await nextConfig.headers?.()) ?? [];
    const framing = rules.find((rule) =>
      rule.headers.some((header) => header.key === 'X-Frame-Options'),
    );
    expect(framing).toBeDefined();
    expect(getPathMatch(framing?.source ?? '', { removeUnnamedParams: true })('/docs')).not.toBe(
      false,
    );
  });
});
