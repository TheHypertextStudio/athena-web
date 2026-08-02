/**
 * `test-oauth` generic-oauth provider gating (SCR-07 real-ceremony fixture).
 *
 * @remarks
 * `packages/auth/src/auth-builder.ts` mounts Better Auth's `genericOAuth` plugin, configured
 * with a `test-oauth` provider pointed at the fake authorization server
 * `apps/api/src/lib/oauth-stub-provider.ts` runs, ONLY when `APP_MODE ∈ {local,test}`. These
 * tests are the required proof that the gate actually holds: the provider is present with the
 * expected shape in `local`/`test`, and structurally absent — not merely unreachable, genuinely
 * never constructed — in `production` or when `APP_MODE` is unset (the production shape, since
 * the env contract requires it be set for a real deploy). The e2e spec
 * (`apps/web/e2e/auth/oauth-sign-in.spec.ts`) is what proves the ceremony itself mints a real
 * session; this file's job is narrower and unit-testable: prove the option assembly is right and
 * the production gate cannot be bypassed.
 */
import { describe, expect, it } from 'vitest';

// `../../src/index` unconditionally imports the validated `@docket/env/api` env at module scope
// (to build the mailer / `devEchoSignupCode`) even though these tests only exercise the pure
// `buildAuthOptions` function — vitest gives each test FILE its own module registry, so this
// mirrors the same pre-seeding `tests/builder/auth.test.ts` does before its first import.
process.env['AGENT_MAX_TURNS'] = '8';
process.env['ATHENA_ASYNC_RUNNER_ENABLED'] = 'false';

const SECRET = 'test-secret-at-least-32-characters-long';
const MAILER_DEPS = { mailer: { send: async () => undefined } } as const;

/** The same baseline every optional-gate test in `auth.test.ts` starts from. */
const baseEnv = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
  BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
} as const;

/** The shape `genericOAuth({config: [...]})` records under a plugin's `.options`. */
interface GenericOAuthProviderShape {
  readonly providerId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly userInfoUrl: string;
  readonly scopes: string[];
  readonly pkce: boolean;
}

/** Pull the `test-oauth` provider config out of a built `BetterAuthOptions.plugins` array. */
function findTestOAuthConfig(
  plugins: { id: string; options?: unknown }[] | undefined,
): GenericOAuthProviderShape | undefined {
  const plugin = (plugins ?? []).find((p) => p.id === 'generic-oauth') as
    | { options?: { config?: GenericOAuthProviderShape[] } }
    | undefined;
  return plugin?.options?.config?.[0];
}

describe('test-oauth generic-oauth provider gating', () => {
  it('is structurally absent when APP_MODE is unset (the production env shape)', async () => {
    const { buildAuthOptions } = await import('../../src/index');
    const opts = buildAuthOptions(baseEnv, MAILER_DEPS);
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).not.toContain('generic-oauth');
    expect(findTestOAuthConfig(opts.plugins)).toBeUndefined();
  });

  it('is structurally absent when APP_MODE is production — no code path can mount it', async () => {
    const { buildAuthOptions } = await import('../../src/index');
    const opts = buildAuthOptions({ ...baseEnv, APP_MODE: 'production' }, MAILER_DEPS);
    const ids = (opts.plugins ?? []).map((p) => p.id);
    expect(ids).not.toContain('generic-oauth');
    expect(findTestOAuthConfig(opts.plugins)).toBeUndefined();
  });

  it('mounts when APP_MODE is local', async () => {
    const { buildAuthOptions } = await import('../../src/index');
    const opts = buildAuthOptions({ ...baseEnv, APP_MODE: 'local' }, MAILER_DEPS);
    expect((opts.plugins ?? []).map((p) => p.id)).toContain('generic-oauth');
  });

  it('mounts when APP_MODE is test, wired to the local stub AS derived from BETTER_AUTH_URL', async () => {
    const { buildAuthOptions } = await import('../../src/index');
    const opts = buildAuthOptions({ ...baseEnv, APP_MODE: 'test' }, MAILER_DEPS);
    const config = findTestOAuthConfig(opts.plugins);
    expect(config).toBeDefined();
    expect(config).toMatchObject({
      providerId: 'test-oauth',
      authorizationUrl: 'http://localhost:3000/api/auth-test/oauth-stub/authorize',
      tokenUrl: 'http://localhost:3000/api/auth-test/oauth-stub/token',
      userInfoUrl: 'http://localhost:3000/api/auth-test/oauth-stub/userinfo',
      scopes: ['openid', 'email', 'profile'],
      pkce: false,
    });
    // Not asserting the literal credential strings here (that would just duplicate the
    // constant) — only that they are non-empty, since `apps/api/src/lib/oauth-stub-provider.ts`
    // validates the real values independently and a mismatch fails the e2e ceremony loudly.
    expect(config?.clientId).toBeTruthy();
    expect(config?.clientSecret).toBeTruthy();
  });

  it('strips a trailing slash from BETTER_AUTH_URL before building the stub URLs (no double slash)', async () => {
    const { buildAuthOptions } = await import('../../src/index');
    const opts = buildAuthOptions(
      { ...baseEnv, APP_MODE: 'local', BETTER_AUTH_URL: 'http://localhost:3000/' },
      MAILER_DEPS,
    );
    const config = findTestOAuthConfig(opts.plugins);
    expect(config?.authorizationUrl).toBe(
      'http://localhost:3000/api/auth-test/oauth-stub/authorize',
    );
    expect(config?.tokenUrl).toBe('http://localhost:3000/api/auth-test/oauth-stub/token');
    expect(config?.userInfoUrl).toBe('http://localhost:3000/api/auth-test/oauth-stub/userinfo');
  });
});
