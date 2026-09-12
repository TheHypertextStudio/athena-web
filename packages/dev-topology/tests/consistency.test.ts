import { describe, expect, it } from 'vitest';

import type { CheckoutIdentity } from '../src/checkout';
import { assertDevTopology, checkDevTopology } from '../src/consistency';
import type { EnvBag } from '../src/hosts';
import { explicitPortTopology } from '../src/topology';

const WORKTREE: CheckoutIdentity = {
  root: '/repo/.worktrees/feature-x',
  gitDir: '/repo/.git/worktrees/feature-x',
  gitCommonDir: '/repo/.git',
  branch: 'claude/feature-x',
};

function coherent(): EnvBag {
  return {
    ...explicitPortTopology(WORKTREE).env,
    BETTER_AUTH_COOKIE_DOMAIN: 'docket.localhost',
  };
}

function variablesOf(env: EnvBag): readonly string[][] {
  return checkDevTopology(env).map((finding) => [...finding.variables]);
}

describe('dev topology consistency', () => {
  it('accepts a topology the resolver produced', () => {
    expect(checkDevTopology(coherent())).toEqual([]);
    expect(() => {
      assertDevTopology(coherent());
    }).not.toThrow();
  });

  it('accepts an environment that names no hosts at all', () => {
    // A deployed environment supplies real platform values; absence is not a disagreement.
    expect(checkDevTopology({})).toEqual([]);
  });

  it('catches a browser value left on another stack', () => {
    const env = coherent();
    env['NEXT_PUBLIC_API_URL'] = 'http://api.docket.localhost:1356';
    expect(variablesOf(env)).toContainEqual(['API_URL', 'NEXT_PUBLIC_API_URL']);
  });

  it('catches a relying-party id that is not a suffix of the origin', () => {
    const env = coherent();
    env['BETTER_AUTH_PASSKEY_RP_ID'] = 'feature-x.docket.localhost';
    env['NEXT_PUBLIC_PASSKEY_RP_ID'] = 'feature-x.docket.localhost';
    // The API is a sibling host, so a prefixed relying party excludes it.
    expect(variablesOf(env)).toContainEqual(['BETTER_AUTH_PASSKEY_RP_ID', 'API_URL']);
  });

  it('catches a cookie domain that cannot cover both app and api', () => {
    const env = coherent();
    env['BETTER_AUTH_COOKIE_DOMAIN'] = 'feature-x.docket.localhost';
    expect(variablesOf(env)).toContainEqual(['BETTER_AUTH_COOKIE_DOMAIN', 'API_URL']);
  });

  it('catches an app origin missing from the trusted origins', () => {
    const env = coherent();
    env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'http://docket.localhost:1355';
    expect(variablesOf(env)).toContainEqual(['BETTER_AUTH_TRUSTED_ORIGINS', 'APP_URL']);
  });

  it('catches a host missing from the allowed hosts', () => {
    const env = coherent();
    env['BETTER_AUTH_ALLOWED_HOSTS'] = 'docket.localhost:1355';
    const found = variablesOf(env);
    expect(found).toContainEqual(['BETTER_AUTH_ALLOWED_HOSTS', 'APP_URL']);
    expect(found).toContainEqual(['BETTER_AUTH_ALLOWED_HOSTS', 'API_URL']);
  });

  it('catches auth, oidc and mcp values pointing off this stack', () => {
    const env = coherent();
    env['BETTER_AUTH_URL'] = 'http://api.docket.localhost:1356';
    env['OIDC_LOGIN_PAGE_URL'] = 'http://docket.localhost:1355/sign-in';
    env['MCP_ALLOWED_ORIGINS'] = 'http://docket.localhost:1355';
    const found = variablesOf(env);
    expect(found).toContainEqual(['BETTER_AUTH_URL', 'API_URL']);
    expect(found).toContainEqual(['OIDC_LOGIN_PAGE_URL', 'APP_URL']);
    expect(found).toContainEqual(['MCP_ALLOWED_ORIGINS', 'APP_URL']);
  });

  it('names every disagreement and its symptom when it throws', () => {
    const env = coherent();
    env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'http://docket.localhost:1355';
    let message = '';
    try {
      assertDevTopology(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('BETTER_AUTH_TRUSTED_ORIGINS');
    // The symptom belongs in the message: recognising it from the outside is the whole point.
    expect(message).toContain('Invalid origin');
    expect(message).toContain('pnpm dev:doctor');
  });

  it('ignores values that are not URLs rather than reporting them as mismatches', () => {
    expect(checkDevTopology({ APP_URL: 'not-a-url', API_URL: 'also-not' })).toEqual([]);
  });
});
