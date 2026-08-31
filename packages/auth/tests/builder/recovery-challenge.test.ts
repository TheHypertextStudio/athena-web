/**
 * Unit tests for the `recoveryChallenge` plugin's own path-matching rate-limit rules.
 *
 * @remarks
 * Better Auth's rate limiter only runs in production (dev/test stay unthrottled — see
 * `auth-builder.ts`), so the live HTTP test suite in `auth.test.ts` never actually drives
 * these `pathMatcher` closures through Better Auth's own rate-limit middleware. They are
 * plain, pure functions, though, so this calls them directly off the plugin's declared
 * `rateLimit` array — the same shape Better Auth would call them with.
 */
import { describe, expect, it } from 'vitest';

// The API env contract rejects a missing turn budget at process validation. `recovery-challenge`
// transitively imports `backup-codes`, which imports `@docket/env/api` — declare the same
// test-only budget before that (dynamic) import, mirroring `builder/auth.test.ts`. A static
// top-level import would be hoisted ahead of these assignments, so the module under test is
// imported dynamically, after this runs.
process.env['AGENT_MAX_TURNS'] = '8';
process.env['ATHENA_ASYNC_RUNNER_ENABLED'] = 'false';
process.env['ATHENA_LATTICE_SUBMISSIONS_ENABLED'] = 'false';
process.env['ATHENA_LATTICE_POLLING_ENABLED'] = 'false';
process.env['LINEAR_AGENT_ENABLED'] = 'false';

describe('recoveryChallenge rate-limit path matchers', () => {
  it('declares a matcher for the recovery-challenge path', async () => {
    const { recoveryChallenge } = await import('../../src/recovery-challenge');
    const [rule] = recoveryChallenge().rateLimit ?? [];
    expect(rule).toBeDefined();
    expect(rule?.pathMatcher('/two-factor/recovery-challenge')).toBe(true);
    expect(rule?.pathMatcher('/two-factor/verify-backup-code')).toBe(false);
    expect(rule?.pathMatcher('/some/other/path')).toBe(false);
  });

  it('declares a matcher for the backup-code verify path', async () => {
    const { recoveryChallenge } = await import('../../src/recovery-challenge');
    const [, rule] = recoveryChallenge().rateLimit ?? [];
    expect(rule).toBeDefined();
    expect(rule?.pathMatcher('/two-factor/verify-backup-code')).toBe(true);
    expect(rule?.pathMatcher('/two-factor/recovery-challenge')).toBe(false);
    expect(rule?.pathMatcher('/some/other/path')).toBe(false);
  });
});
