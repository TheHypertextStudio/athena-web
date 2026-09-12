import { describe, expect, it } from 'vitest';

import type { CheckoutIdentity } from '../src/checkout';
import { checkDevTopology } from '../src/consistency';
import type { EnvBag } from '../src/hosts';
import {
  applyDevHostPrefix,
  canonicalServiceHost,
  DELIBERATELY_UNPREFIXED,
  HOST_BEARING_VARS,
  portlessPrefix,
  prefixDevHosts,
} from '../src/hosts';
import { explicitPortTopology, shellExports } from '../src/topology';

describe('portless service hosts', () => {
  it('maps service names onto the hosts they own', () => {
    expect(canonicalServiceHost('docket')).toBe('docket.localhost');
    expect(canonicalServiceHost('api.docket')).toBe('api.docket.localhost');
    expect(canonicalServiceHost('admin.docket')).toBe('admin.docket.localhost');
    expect(canonicalServiceHost('something-else')).toBeUndefined();
  });

  it('reads the prefix a worktree was assigned', () => {
    expect(portlessPrefix('https://feature-x.docket.localhost', 'docket')).toBe('feature-x');
    expect(portlessPrefix('https://feature-x.api.docket.localhost', 'api.docket')).toBe(
      'feature-x',
    );
  });

  it('reports no prefix on a canonical host or an unusable input', () => {
    expect(portlessPrefix('https://docket.localhost', 'docket')).toBeUndefined();
    expect(portlessPrefix('https://api.docket.localhost', 'api.docket')).toBeUndefined();
    expect(portlessPrefix(undefined, 'docket')).toBeUndefined();
    expect(portlessPrefix('https://feature-x.docket.localhost', undefined)).toBeUndefined();
    expect(portlessPrefix('not a url', 'docket')).toBeUndefined();
    // A host outside the service's own family says nothing about this service.
    expect(portlessPrefix('https://feature-x.other.test', 'docket')).toBeUndefined();
  });
});

describe('prefixing dev hosts', () => {
  it('rewrites the host and leaves scheme, port and path alone', () => {
    expect(prefixDevHosts('http://api.docket.localhost:1356/v1/health', 'feature-x')).toBe(
      'http://feature-x.api.docket.localhost:1356/v1/health',
    );
  });

  it('rewrites a bare hostname and every entry of a list', () => {
    expect(prefixDevHosts('docket.localhost', 'feature-x')).toBe('feature-x.docket.localhost');
    expect(
      prefixDevHosts(
        'http://docket.localhost:1355,http://admin.docket.localhost:1357',
        'feature-x',
      ),
    ).toBe('http://feature-x.docket.localhost:1355,http://feature-x.admin.docket.localhost:1357');
  });

  it('leaves an already-prefixed host untouched so reapplying is safe', () => {
    const once = prefixDevHosts('http://docket.localhost:1355', 'feature-x');
    expect(prefixDevHosts(once, 'feature-x')).toBe(once);
  });

  it('leaves hosts outside the dev domain alone', () => {
    expect(prefixDevHosts('https://clearthedocket.com', 'feature-x')).toBe(
      'https://clearthedocket.com',
    );
  });
});

describe('applying the prefix to an environment', () => {
  it('rewrites every host-bearing variable that is set', () => {
    const env: EnvBag = {
      API_URL: 'http://api.docket.localhost:1356',
      NEXT_PUBLIC_API_URL: 'http://api.docket.localhost:1356',
      MCP_ALLOWED_ORIGINS: 'http://docket.localhost:1355',
      OIDC_LOGIN_PAGE_URL: 'http://docket.localhost:1355/sign-in',
      UNRELATED_URL: 'http://docket.localhost:1355',
    };
    const changed = applyDevHostPrefix(env, 'feature-x');

    expect(changed).toContain('MCP_ALLOWED_ORIGINS');
    expect(changed).toContain('OIDC_LOGIN_PAGE_URL');
    expect(env['API_URL']).toBe('http://feature-x.api.docket.localhost:1356');
    // Only the enumerated variables are touched; a blanket rewrite would reach secrets.
    expect(changed).not.toContain('UNRELATED_URL');
    expect(env['UNRELATED_URL']).toBe('http://docket.localhost:1355');
  });

  it('leaves the cookie domain on the shared parent', () => {
    const env: EnvBag = { BETTER_AUTH_COOKIE_DOMAIN: 'docket.localhost' };
    expect(applyDevHostPrefix(env, 'feature-x')).toEqual([]);
    expect(env['BETTER_AUTH_COOKIE_DOMAIN']).toBe('docket.localhost');
  });

  it('declares the cookie domain as deliberately unprefixed rather than merely omitting it', () => {
    expect(DELIBERATELY_UNPREFIXED).toContain('BETTER_AUTH_COOKIE_DOMAIN');
  });

  it('leaves the passkey relying-party id on the shared parent of app and api', () => {
    // Prefixing it produced `<prefix>.docket.localhost`, which is a sibling of the API host rather
    // than a parent, so the ceremony failed with CHALLENGE_NOT_FOUND. The explicit-port path always
    // used the shared parent and always worked; this keeps the two paths from disagreeing again.
    const env: EnvBag = {
      BETTER_AUTH_PASSKEY_RP_ID: 'docket.localhost',
      NEXT_PUBLIC_PASSKEY_RP_ID: 'docket.localhost',
    };
    expect(applyDevHostPrefix(env, 'feature-x')).toEqual([]);
    expect(env['BETTER_AUTH_PASSKEY_RP_ID']).toBe('docket.localhost');
    expect(env['NEXT_PUBLIC_PASSKEY_RP_ID']).toBe('docket.localhost');
  });

  it('produces a coherent environment for a worktree, by the consistency checker', () => {
    // The end-to-end property: correcting a canonical environment for a worktree must leave
    // something the launchers will accept, or `pnpm dev` cannot start at all.
    const env: EnvBag = {
      APP_URL: 'http://docket.localhost:1355',
      API_URL: 'http://api.docket.localhost:1356',
      NEXT_PUBLIC_APP_URL: 'http://docket.localhost:1355',
      NEXT_PUBLIC_API_URL: 'http://api.docket.localhost:1356',
      BETTER_AUTH_URL: 'http://api.docket.localhost:1356',
      BETTER_AUTH_TRUSTED_ORIGINS: 'http://docket.localhost:1355',
      BETTER_AUTH_ALLOWED_HOSTS: 'docket.localhost:1355,api.docket.localhost:1356',
      BETTER_AUTH_COOKIE_DOMAIN: 'docket.localhost',
      BETTER_AUTH_PASSKEY_RP_ID: 'docket.localhost',
      NEXT_PUBLIC_PASSKEY_RP_ID: 'docket.localhost',
      MCP_ALLOWED_ORIGINS: 'http://docket.localhost:1355',
      OIDC_LOGIN_PAGE_URL: 'http://docket.localhost:1355/sign-in',
    };
    applyDevHostPrefix(env, 'feature-x');
    expect(checkDevTopology(env)).toEqual([]);
  });

  it('covers every host-bearing variable the explicit-port topology sets', () => {
    // The two modes have to agree on which variables name a host, or correcting one mode leaves
    // the other pointed at a different checkout.
    const topology = explicitPortTopology({
      root: '/repo',
      gitDir: '/repo/.git',
      gitCommonDir: '/repo/.git',
      branch: 'main',
    } satisfies CheckoutIdentity);

    const hostNaming = Object.entries(topology.env)
      .filter(([, value]) => value.includes('docket.localhost'))
      .map(([name]) => name);

    for (const name of hostNaming) {
      expect(HOST_BEARING_VARS).toContain(name);
    }
  });
});

describe('shell rendering', () => {
  it('quotes every value so a comma-separated list survives eval', () => {
    const rendered = shellExports({ A: 'one,two', B: 'three' });
    expect(rendered).toBe('export A="one,two"\nexport B="three"');
  });
});
