/**
 * Unit tests for the `signupChallenge` plugin's own path-matching rate-limit rules.
 *
 * @remarks
 * Better Auth's rate limiter only runs in production (dev/test stay unthrottled — see
 * `auth-builder.ts`), so the live HTTP test suite in `auth.test.ts` never actually drives
 * these `pathMatcher` closures through Better Auth's own rate-limit middleware. They are
 * plain, pure functions, though, so this calls them directly off the plugin's declared
 * `rateLimit` array — the same shape Better Auth would call them with.
 */
import { describe, expect, it, vi } from 'vitest';

// The API env contract rejects a missing turn budget at process validation. `signup-challenge`
// transitively imports `signup-intent` and `@docket/mail` (via its `Mailer` type only, but the
// package also pulls `@docket/env/api` elsewhere in this suite) — declare the same test-only
// budget before the dynamic import below, mirroring `builder/auth.test.ts`.
process.env['AGENT_MAX_TURNS'] = '8';
process.env['ATHENA_ASYNC_RUNNER_ENABLED'] = 'false';
process.env['LINEAR_AGENT_ENABLED'] = 'false';

describe('signupChallenge rate-limit path matchers', () => {
  const noopMailer = { send: vi.fn(async () => undefined) };

  it('declares a matcher for the request-code path', async () => {
    const { signupChallenge } = await import('../../src/signup-challenge');
    const [rule] = signupChallenge({ mailer: noopMailer }).rateLimit ?? [];
    expect(rule).toBeDefined();
    expect(rule?.pathMatcher('/sign-up/request-code')).toBe(true);
    expect(rule?.pathMatcher('/sign-up/verify-code')).toBe(false);
    expect(rule?.pathMatcher('/some/other/path')).toBe(false);
  });

  it('declares a matcher for the verify-code path', async () => {
    const { signupChallenge } = await import('../../src/signup-challenge');
    const [, rule] = signupChallenge({ mailer: noopMailer }).rateLimit ?? [];
    expect(rule).toBeDefined();
    expect(rule?.pathMatcher('/sign-up/verify-code')).toBe(true);
    expect(rule?.pathMatcher('/sign-up/request-code')).toBe(false);
    expect(rule?.pathMatcher('/some/other/path')).toBe(false);
  });
});
