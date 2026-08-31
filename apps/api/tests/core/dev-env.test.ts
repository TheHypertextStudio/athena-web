/**
 * The dev-only env preload that keeps a worktree's URLs pointing at its own Portless host.
 *
 * @remarks
 * Every linked worktree gets its own Portless prefix, so `docket.localhost` in the committed
 * `.env.local` has to become `<prefix>.docket.localhost` before `@docket/env` validates it. When
 * this rewriting is wrong the failure is not a crash: the API boots, the browser reaches a
 * *different* worktree's origin, and passkey ceremonies fail with `CHALLENGE_NOT_FOUND` — a
 * symptom several steps removed from the cause.
 *
 * The module runs its work at import time, so each case re-imports it under a stubbed environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Import the preload fresh, with `process.env` as the case set it up. */
async function runPreload(): Promise<void> {
  vi.resetModules();
  await import('../../src/dev-env');
}

const HOST_VARS = ['API_URL', 'WEB_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_TRUSTED_ORIGINS'] as const;

describe('worktree Portless prefixing', () => {
  beforeEach(() => {
    for (const name of HOST_VARS) vi.stubEnv(name, '');
    vi.stubEnv('PORTLESS_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('prefixes every host-bearing variable with this worktree’s Portless prefix', async () => {
    vi.stubEnv('PORTLESS_URL', 'https://mybranch.api.docket.localhost');
    vi.stubEnv('API_URL', 'https://api.docket.localhost');
    vi.stubEnv('WEB_URL', 'https://docket.localhost');
    vi.stubEnv(
      'BETTER_AUTH_TRUSTED_ORIGINS',
      'https://docket.localhost,https://admin.docket.localhost',
    );

    await runPreload();

    expect(process.env['API_URL']).toBe('https://mybranch.api.docket.localhost');
    expect(process.env['WEB_URL']).toBe('https://mybranch.docket.localhost');
    // Every entry of a comma-joined list is rewritten, not just the first.
    expect(process.env['BETTER_AUTH_TRUSTED_ORIGINS']).toBe(
      'https://mybranch.docket.localhost,https://mybranch.admin.docket.localhost',
    );
  });

  it('leaves a value that already carries the prefix alone', async () => {
    // The preload runs again on every `tsx watch` restart, so it has to be idempotent: a second
    // pass must not produce `mybranch.mybranch.docket.localhost`.
    vi.stubEnv('PORTLESS_URL', 'https://mybranch.api.docket.localhost');
    vi.stubEnv('API_URL', 'https://mybranch.api.docket.localhost');

    await runPreload();

    expect(process.env['API_URL']).toBe('https://mybranch.api.docket.localhost');
  });

  it.each([
    ['there is no Portless URL', ''],
    ['the Portless URL is not a URL at all', 'not://a valid url::'],
    ['the Portless host is not this service', 'https://mybranch.web.docket.localhost'],
    ['the host carries no prefix', 'https://api.docket.localhost'],
    // A leading dot parses as a host that ends with the service suffix but yields an empty
    // prefix. Rewriting on it would produce `..docket.localhost`, which resolves to nothing.
    ['the prefix is empty', 'https://.api.docket.localhost'],
  ])('leaves the environment untouched when %s', async (_case, portlessUrl) => {
    vi.stubEnv('PORTLESS_URL', portlessUrl);
    vi.stubEnv('API_URL', 'https://api.docket.localhost');

    await runPreload();

    expect(process.env['API_URL']).toBe('https://api.docket.localhost');
  });

  it('skips variables that are unset rather than inventing a value for them', async () => {
    vi.stubEnv('PORTLESS_URL', 'https://mybranch.api.docket.localhost');
    vi.stubEnv('API_URL', 'https://api.docket.localhost');
    vi.stubEnv('WEB_URL', '');

    await runPreload();

    expect(process.env['API_URL']).toBe('https://mybranch.api.docket.localhost');
    expect(process.env['WEB_URL']).toBe('');
  });
});
