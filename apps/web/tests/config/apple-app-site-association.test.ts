import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['API_URL'] = 'https://api.clearthedocket.com';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://clearthedocket.com';
  process.env['BETTER_AUTH_PASSKEY_LEGACY_RP_ID'] = 'docket.hypertext.studio';
});

import nextConfig from '../../next.config';

describe('Apple app-site association', () => {
  it('publishes the native Docket application as a web credential app', () => {
    const path = resolve(process.cwd(), 'public/.well-known/apple-app-site-association');
    const association = JSON.parse(readFileSync(path, 'utf8')) as unknown;

    expect(association).toEqual({
      webcredentials: {
        apps: ['T95VDD3A4W.studio.hypertext.docket'],
      },
    });
  });

  it('serves the extensionless document as JSON', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const associationRules = rules.filter(
      (rule) => rule.source === '/.well-known/apple-app-site-association',
    );

    expect(associationRules).toHaveLength(1);
    expect(associationRules[0]?.headers).toContainEqual(
      expect.objectContaining({
        key: 'Content-Type',
        value: 'application/json',
      }),
    );
  });

  it('keeps the legacy trust document direct while redirecting every other path', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const legacyRedirects = redirects.filter((rule) =>
      rule.has?.some(
        (condition) =>
          condition.type === 'host' && condition.value === 'docket\\.hypertext\\.studio',
      ),
    );

    expect(legacyRedirects).toHaveLength(1);
    const legacyRedirect = legacyRedirects[0];
    expect(legacyRedirect?.destination).toBe('https://clearthedocket.com/:path*');
    const matches = getPathMatch(legacyRedirect?.source ?? '', { removeUnnamedParams: true });
    expect(matches('/.well-known/apple-app-site-association')).toBe(false);
    expect(matches('/')).not.toBe(false);
    expect(matches('/sign-in')).not.toBe(false);
    expect(matches('/anything/nested')).not.toBe(false);
  });
});
