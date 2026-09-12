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

  it('carries the disagreeing variables and a symptom on every finding', () => {
    const env = coherent();
    env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'http://docket.localhost:1355';
    const findings = checkDevTopology(env);

    expect(findings).not.toHaveLength(0);
    for (const finding of findings) {
      // Structure rather than wording: naming the variables and stating a symptom is the
      // behaviour, and pinning the prose made a command rename fail a test about neither.
      expect(finding.variables.length).toBeGreaterThanOrEqual(2);
      expect(finding.problem.length).toBeGreaterThan(0);
      expect(finding.consequence.length).toBeGreaterThan(0);
    }
    expect(findings.map((finding) => [...finding.variables])).toContainEqual([
      'BETTER_AUTH_TRUSTED_ORIGINS',
      'APP_URL',
    ]);
  });

  it('throws with every finding rendered when the environment contradicts itself', () => {
    const env = coherent();
    env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'http://docket.localhost:1355';
    let message = '';
    try {
      assertDevTopology(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The rendered message is the findings' own text, so assert it carries them rather than
    // restating the words it happens to use.
    for (const finding of checkDevTopology(env)) {
      expect(message).toContain(finding.problem);
      expect(message).toContain(finding.consequence);
    }
  });

  it('ignores values that are not URLs rather than reporting them as mismatches', () => {
    expect(checkDevTopology({ APP_URL: 'not-a-url', API_URL: 'also-not' })).toEqual([]);
  });

  it('reads the app origin from WEB_URL when APP_URL is absent', () => {
    // The checked-in env file sets WEB_URL and no APP_URL, so keying only off APP_URL left the
    // Portless path almost entirely unchecked — absence read as agreement.
    const env: EnvBag = { ...coherent() };
    env['WEB_URL'] = env['APP_URL'];
    delete env['APP_URL'];
    delete env['NEXT_PUBLIC_APP_URL'];
    expect(checkDevTopology(env)).toEqual([]);

    env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'http://docket.localhost:1355';
    expect(variablesOf(env)).toContainEqual(['BETTER_AUTH_TRUSTED_ORIGINS', 'APP_URL']);
  });

  it('reports a stack that names an API but no app at all', () => {
    const env: EnvBag = { ...coherent() };
    delete env['APP_URL'];
    delete env['WEB_URL'];
    expect(variablesOf(env)).toContainEqual(['APP_URL', 'WEB_URL']);
  });

  it('stays quiet when nothing names an API either', () => {
    expect(checkDevTopology({ BETTER_AUTH_COOKIE_DOMAIN: 'docket.localhost' })).toEqual([]);
  });
});
