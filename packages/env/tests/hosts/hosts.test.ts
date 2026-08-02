/**
 * Behavior tests for the user-facing host contract.
 *
 * @remarks
 * The bugs worth catching here are the ones that are silent in a deploy and loud for a user:
 * a port leaking into a WebAuthn relying-party id or a cookie `Domain`; a suffix match letting
 * `notdocket.place` pass as "under `docket.place`"; a derived mail host that accepts no mail;
 * and a half-applied domain cutover that boots healthy while a user-facing host still answers
 * on the old domain.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  apexOf,
  assertHostConfigIsolated,
  browserHostConfig,
  HOST_ROLES,
  isUnderApex,
  parseHost,
  requireHost,
  requireOrigin,
  requireSupportEmail,
  resolveHost,
  resolveHostConfig,
  WEB_HOST_ROLES,
} from '../../src/hosts';

describe('parseHost', () => {
  it.each([
    ['https://docket.place/briefs?x=1', 'docket.place', undefined],
    ['docket.place', 'docket.place', undefined],
    ['HTTPS://Docket.Place', 'docket.place', undefined],
    ['docket.place.', 'docket.place', undefined],
    ['http://docket.localhost:1355', 'docket.localhost', 1355],
    ['docket.localhost:1355', 'docket.localhost', 1355],
    ['  docket.place  ', 'docket.place', undefined],
  ])('reads %s as %s', (input, host, port) => {
    expect(parseHost(input)).toEqual({ host, port });
  });

  it.each([[undefined], [null], [''], ['   '], ['https://'], ['http://:1355'], ['http://']])(
    'returns undefined rather than a guess for %s',
    (input) => {
      // These either throw in `new URL` or leave no authority; a partially parsed host would be
      // worse than none, because it would silently become somebody's cookie domain.
      expect(parseHost(input)).toBeUndefined();
    },
  );

  it.each([['file:///tmp/x'], ['postgres://']])(
    'returns undefined for %s, which parses but has no host',
    (input) => {
      // A non-special scheme with an empty authority is accepted by `new URL` and yields an
      // empty hostname — the one case where parsing succeeds and the result is still unusable.
      expect(parseHost(input)).toBeUndefined();
    },
  );
});

describe('apexOf', () => {
  it.each([
    ['docket.hypertext.studio', 'hypertext.studio'],
    ['api.docket.place', 'docket.place'],
    ['docket.place', 'docket.place'],
    ['branch.api.docket.localhost', 'docket.localhost'],
    ['localhost', 'localhost'],
  ])('reduces %s to %s', (host, apex) => {
    expect(apexOf(host)).toBe(apex);
  });

  it('is documented as wrong for multi-label public suffixes, and is', () => {
    // Recorded deliberately: this is why `./custom-domain` never calls it on user input.
    expect(apexOf('shop.example.co.uk')).toBe('co.uk');
  });
});

describe('resolveHostConfig', () => {
  it('moves the whole product with one variable', () => {
    const config = resolveHostConfig({ rootDomain: 'docket.place' });

    expect(config.rootDomain).toBe('docket.place');
    expect(config.hosts.app?.origin).toBe('https://docket.place');
    expect(config.hosts.api?.origin).toBe('https://api.docket.place');
    expect(config.hosts.admin?.origin).toBe('https://admin.docket.place');
    expect(config.hosts.brief?.origin).toBe('https://briefs.docket.place');
    expect(config.supportEmail).toBe('support@docket.place');
    expect(config.passkeyRpId).toBe('docket.place');
    expect(config.customDomainTarget).toBe('briefs.docket.place');
    for (const role of WEB_HOST_ROLES) expect(resolveHost(config, role)?.source).toBe('derived');
  });

  it('derives the apex from the app URL when none is set', () => {
    // Today's production shape: two unrelated names sharing an apex, no PUBLIC_ROOT_DOMAIN.
    const config = resolveHostConfig({
      appUrl: 'https://docket.example.test',
      apiUrl: 'https://docket-api.example.test',
    });

    expect(config.rootDomain).toBe('example.test');
    expect(config.hosts.app?.source).toBe('configured');
    expect(config.hosts.api?.host).toBe('docket-api.example.test');
    expect(config.hosts.admin?.host).toBe('admin.example.test');
  });

  it('lets an explicit variable override just its own host', () => {
    const config = resolveHostConfig({
      rootDomain: 'docket.place',
      briefHost: 'read.docket.place',
      customDomainTarget: 'edge.docket.place',
      adminUrl: 'https://ops.docket.place',
    });

    expect(config.hosts.brief).toMatchObject({ host: 'read.docket.place', source: 'configured' });
    expect(config.hosts.admin).toMatchObject({ host: 'ops.docket.place', source: 'configured' });
    expect(config.hosts.api?.source).toBe('derived');
    expect(config.customDomainTarget).toBe('edge.docket.place');
  });

  it('never derives the Athena mail host', () => {
    // A derived mail host would have no MX records, so every inbound message would bounce while
    // the configuration looked complete. Absent is the honest answer.
    const derived = resolveHostConfig({ rootDomain: 'docket.place' });
    expect(derived.hosts['athena-mail']).toBeUndefined();

    const configured = resolveHostConfig({
      rootDomain: 'docket.place',
      athenaInboundMailHost: 'inbox.athena.example.test',
    });
    expect(configured.hosts['athena-mail']).toMatchObject({
      host: 'inbox.athena.example.test',
      source: 'configured',
    });
  });

  it('keeps the port out of the host but in the origin', () => {
    // A port in a cookie `Domain`, a WebAuthn RP id, or a DNS name is always a bug; a missing
    // port in a local origin breaks every dev redirect.
    const config = resolveHostConfig({ appUrl: 'http://docket.localhost:1355' });

    expect(config.hosts.app?.host).toBe('docket.localhost');
    expect(config.hosts.app?.port).toBe(1355);
    expect(config.hosts.app?.origin).toBe('http://docket.localhost:1355');
    expect(config.passkeyRpId).toBe('docket.localhost');
  });

  it('resolves nothing, rather than guessing, from an empty environment', () => {
    const config = resolveHostConfig({});

    expect(config.rootDomain).toBeUndefined();
    expect(config.supportEmail).toBeUndefined();
    expect(config.customDomainTarget).toBeUndefined();
    expect(config.passkeyRpId).toBeUndefined();
    for (const role of HOST_ROLES) expect(resolveHost(config, role)).toBeUndefined();
  });

  it('prefers an explicit support address and RP id over the derived ones', () => {
    const config = resolveHostConfig({
      rootDomain: 'docket.place',
      supportEmail: '  Help@Docket.Place  ',
      passkeyRpId: 'app.docket.place',
    });

    expect(config.supportEmail).toBe('help@docket.place');
    expect(config.passkeyRpId).toBe('app.docket.place');
  });

  it('treats a blank support address as unset', () => {
    const config = resolveHostConfig({ rootDomain: 'docket.place', supportEmail: '   ' });
    expect(config.supportEmail).toBe('support@docket.place');
  });
});

describe('requireHost / requireOrigin', () => {
  const config = resolveHostConfig({ rootDomain: 'docket.place' });

  it('returns the resolved host', () => {
    expect(requireHost(config, 'brief').host).toBe('briefs.docket.place');
    expect(requireOrigin(config, 'api')).toBe('https://api.docket.place');
  });

  it('names the variable to set when a web host is missing', () => {
    expect(() => requireHost(resolveHostConfig({}), 'brief')).toThrow(/PUBLIC_BRIEF_HOST/);
    expect(() => requireOrigin(resolveHostConfig({}), 'app')).toThrow(/WEB_URL/);
  });

  it('explains why the mail host is never derived', () => {
    expect(() => requireHost(config, 'athena-mail')).toThrow(/ATHENA_INBOUND_MAIL_HOST/);
    expect(() => requireHost(config, 'athena-mail')).toThrow(/bounce/);
  });
});

describe('isUnderApex', () => {
  it.each([
    ['docket.place', 'docket.place', true],
    ['api.docket.place', 'docket.place', true],
    ['a.b.docket.place', 'docket.place', true],
    ['notdocket.place', 'docket.place', false],
    ['docket.place.evil.test', 'docket.place', false],
    ['place', 'docket.place', false],
  ])('%s under %s → %s', (host, apex, expected) => {
    expect(isUnderApex(host, apex)).toBe(expected);
  });
});

describe('assertHostConfigIsolated', () => {
  it('passes when every web host sits on the apex', () => {
    expect(() => {
      assertHostConfigIsolated(
        resolveHostConfig({
          rootDomain: 'docket.place',
          appUrl: 'https://docket.place',
          apiUrl: 'https://api.docket.place',
        }),
      );
    }).not.toThrow();
  });

  it('catches a half-applied cutover and names the stray host', () => {
    // The realistic failure: WEB_URL moved to the new apex, ADMIN_URL did not.
    const config = resolveHostConfig({
      rootDomain: 'docket.place',
      appUrl: 'https://docket.place',
      adminUrl: 'https://docket-admin.old.test',
    });

    expect(() => {
      assertHostConfigIsolated(config);
    }).toThrow(/admin=docket-admin\.old\.test/);
  });

  it('reports every stray host at once', () => {
    const config = resolveHostConfig({
      rootDomain: 'docket.place',
      apiUrl: 'https://docket-api.old.test',
      adminUrl: 'https://docket-admin.old.test',
    });

    const run = (): void => {
      assertHostConfigIsolated(config);
    };
    expect(run).toThrow(/api=docket-api\.old\.test/);
    expect(run).toThrow(/admin=docket-admin\.old\.test/);
    expect(run).toThrow(/are not under/);
  });

  it('exempts the Athena mail host, which GEN-25 permits off-apex', () => {
    expect(() => {
      assertHostConfigIsolated(
        resolveHostConfig({
          rootDomain: 'docket.place',
          appUrl: 'https://docket.place',
          athenaInboundMailHost: 'inbox.athena.old.test',
        }),
      );
    }).not.toThrow();
  });

  it('refuses to pass vacuously when no apex is configured', () => {
    expect(() => {
      assertHostConfigIsolated(resolveHostConfig({}));
    }).toThrow(/PUBLIC_ROOT_DOMAIN/);
  });
});

describe('browserHostConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the browser-visible variables', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://docket.place');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.docket.place');
    vi.stubEnv('NEXT_PUBLIC_BRIEF_HOST', 'read.docket.place');
    vi.stubEnv('NEXT_PUBLIC_PASSKEY_RP_ID', 'docket.place');
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'hello@docket.place');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'docket.place');

    const config = browserHostConfig();

    expect(config.rootDomain).toBe('docket.place');
    expect(config.hosts.brief?.host).toBe('read.docket.place');
    expect(config.supportEmail).toBe('hello@docket.place');
  });

  it('derives the support address from the app URL alone', () => {
    // The state production is in before NEXT_PUBLIC_SUPPORT_EMAIL is ever set: the address must
    // still resolve, and must follow the apex the app is actually served from.
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://docket.example.test');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', '');
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', '');

    expect(requireSupportEmail(browserHostConfig())).toBe('support@example.test');
  });
});

describe('requireSupportEmail', () => {
  it('fails by name when nothing can resolve it', () => {
    expect(() => requireSupportEmail(resolveHostConfig({}))).toThrow(/NEXT_PUBLIC_SUPPORT_EMAIL/);
  });
});
