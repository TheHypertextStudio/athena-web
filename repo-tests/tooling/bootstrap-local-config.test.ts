import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reconcileLocalConfig, validateLocalConfig } from '../../scripts/bootstrap/local-config';
import { parseEnvFile } from '../../scripts/env-file';

const roots: string[] = [];

function fixture(): { envPath: string; examplePath: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'docket-bootstrap-config-'));
  roots.push(root);
  const examplePath = resolve(root, '.env.example');
  copyFileSync(resolve(import.meta.dirname, '../../.env.example'), examplePath);
  return { envPath: resolve(root, '.env.local'), examplePath };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    // Fixtures contain only files created by this test and live outside every repository.
    // Node's test cleanup is preferable to shelling out to a broad recursive target.
    rmSync(root, { recursive: true, force: true });
  }
});

describe('local bootstrap configuration', () => {
  it.each(['darwin', 'linux'] as const)('writes safe defaults once on %s', (platform) => {
    const paths = fixture();

    const result = reconcileLocalConfig({
      ...paths,
      platform,
      generateSecret: (name) => `generated-${name}-00000000000000000000000000000000`,
    });
    const env = parseEnvFile(paths.envPath);

    expect(result).toEqual({ changed: true, diagnostics: [] });
    expect(env['PORT']).toBe('4000');
    expect(env['BETTER_AUTH_COOKIE_DOMAIN']).toBe('docket.localhost');
    expect(env['BETTER_AUTH_PASSKEY_RP_ID']).toBe('docket.localhost');
    expect(env['NEXT_PUBLIC_PASSKEY_RP_ID']).toBe('docket.localhost');
    expect(env['BETTER_AUTH_SECRET']).toMatch(/^generated-BETTER_AUTH_SECRET-/);
    expect(env['CRON_SECRET']).toMatch(/^generated-CRON_SECRET-/);
    expect(env['GOOGLE_OAUTH_TEST_EMAILS']).toBe('');
  });

  it('leaves bytes and mtime unchanged on the second run', () => {
    const paths = fixture();
    let generated = 0;
    const options = {
      ...paths,
      platform: 'darwin' as const,
      generateSecret: (name: string) => `${name}-${String(++generated).padEnd(40, 'x')}`,
    };

    reconcileLocalConfig(options);
    const before = readFileSync(paths.envPath);
    const beforeMtime = statSync(paths.envPath).mtimeMs;
    const result = reconcileLocalConfig(options);

    expect(result).toEqual({ changed: false, diagnostics: [] });
    expect(readFileSync(paths.envPath)).toEqual(before);
    expect(statSync(paths.envPath).mtimeMs).toBe(beforeMtime);
    expect(generated).toBe(2);
  });

  it('preserves valid manual values and unrelated keys', () => {
    const paths = fixture();
    writeFileSync(
      paths.envPath,
      [
        'APP_MODE=local',
        'API_URL=https://api.custom.localhost',
        'WEB_URL=https://custom.localhost',
        'UNRELATED_DEVELOPER_KEY=keep-me',
        '',
      ].join('\n'),
    );

    reconcileLocalConfig({
      ...paths,
      platform: 'linux',
      generateSecret: (name) => `generated-${name}-00000000000000000000000000000000`,
    });
    const env = parseEnvFile(paths.envPath);

    expect(env['API_URL']).toBe('https://api.custom.localhost');
    expect(env['WEB_URL']).toBe('https://custom.localhost');
    expect(env['BETTER_AUTH_URL']).toBe('https://api.custom.localhost');
    expect(env['NEXT_PUBLIC_API_URL']).toBe('https://api.custom.localhost');
    expect(env['NEXT_PUBLIC_APP_URL']).toBe('https://custom.localhost');
    expect(env['UNRELATED_DEVELOPER_KEY']).toBe('keep-me');
  });

  it('creates each generated secret once and never rotates it implicitly', () => {
    const paths = fixture();
    let generated = 0;
    const options = {
      ...paths,
      platform: 'linux' as const,
      generateSecret: (name: string) => `${name}-${String(++generated).padEnd(40, 's')}`,
    };

    reconcileLocalConfig(options);
    const first = parseEnvFile(paths.envPath);
    reconcileLocalConfig(options);
    const second = parseEnvFile(paths.envPath);

    expect(second['BETTER_AUTH_SECRET']).toBe(first['BETTER_AUTH_SECRET']);
    expect(second['CRON_SECRET']).toBe(first['CRON_SECRET']);
    expect(generated).toBe(2);
  });

  it('derives every local auth origin from the canonical API and web origins', () => {
    const paths = fixture();
    writeFileSync(
      paths.envPath,
      'APP_MODE=local\nAPI_URL=https://api.example.localhost\nWEB_URL=https://example.localhost\n',
    );

    reconcileLocalConfig({
      ...paths,
      platform: 'darwin',
      generateSecret: (name) => `generated-${name}-00000000000000000000000000000000`,
    });
    const env = parseEnvFile(paths.envPath);

    expect(env).toMatchObject({
      BETTER_AUTH_URL: 'https://api.example.localhost',
      NEXT_PUBLIC_API_URL: 'https://api.example.localhost',
      NEXT_PUBLIC_APP_URL: 'https://example.localhost',
      MCP_ISSUER_URL: 'https://api.example.localhost',
      MCP_RESOURCE_URL: 'https://api.example.localhost/mcp',
      OIDC_LOGIN_PAGE_URL: 'https://example.localhost/sign-in',
      BETTER_AUTH_PASSKEY_RP_ID: 'example.localhost',
      NEXT_PUBLIC_PASSKEY_RP_ID: 'example.localhost',
      BETTER_AUTH_COOKIE_DOMAIN: 'example.localhost',
    });
  });

  it('reports malformed or mutually inconsistent values without overwriting them', () => {
    const paths = fixture();
    writeFileSync(
      paths.envPath,
      [
        'APP_MODE=local',
        'API_URL=not-a-url',
        'WEB_URL=https://docket.localhost',
        'BETTER_AUTH_URL=https://wrong.localhost',
        'BETTER_AUTH_PASSKEY_RP_ID=docket.localhost',
        'NEXT_PUBLIC_PASSKEY_RP_ID=other.localhost',
        '',
      ].join('\n'),
    );

    const result = reconcileLocalConfig({
      ...paths,
      platform: 'linux',
      generateSecret: (name) => `generated-${name}-00000000000000000000000000000000`,
    });
    const env = parseEnvFile(paths.envPath);

    expect(result.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(
      expect.arrayContaining([
        'env.API_URL.invalid',
        'env.auth.api-origin-mismatch',
        'env.auth.passkey-rp-mismatch',
      ]),
    );
    expect(env['API_URL']).toBe('not-a-url');
    expect(env['BETTER_AUTH_URL']).toBe('https://wrong.localhost');
    expect(env['NEXT_PUBLIC_PASSKEY_RP_ID']).toBe('other.localhost');
    expect(validateLocalConfig(env).length).toBeGreaterThan(0);
  });
});
