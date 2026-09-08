import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['API_URL'] = 'https://api.clearthedocket.com';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://clearthedocket.com';
});

import nextConfig from '../../next.config';

describe('Apple app-site association', () => {
  it('publishes the native Docket application as a web credential app', () => {
    const path = resolve(process.cwd(), 'public/.well-known/apple-app-site-association');
    const association = JSON.parse(readFileSync(path, 'utf8')) as unknown;

    expect(association).toEqual({
      webcredentials: {
        apps: ['39AB9DY3K8.studio.hypertext.docket'],
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
});
