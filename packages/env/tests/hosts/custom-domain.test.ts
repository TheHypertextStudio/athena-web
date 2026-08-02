/**
 * Behavior tests for per-workspace custom domains.
 *
 * @remarks
 * Three classes of bug are what this file exists for, and each is a real security or
 * data-integrity failure rather than a cosmetic one:
 *
 * - **Normalization drift.** If two callers spell the same host differently, the uniqueness
 *   constraint that stops workspace B stealing workspace A's domain (CORE-30) never fires.
 * - **Verification that passes too easily.** A substring match, a stale token, or a swallowed
 *   resolver error would each let an unverified domain serve (CORE-31, MISS-04).
 * - **Reserved-host escape.** Claiming a host on Docket's own apex would let a workspace serve
 *   its content from an origin the browser already trusts.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  acceptCustomDomain,
  CUSTOM_DOMAIN_TOKEN_LENGTH,
  CUSTOM_DOMAIN_TXT_LABEL,
  CUSTOM_DOMAIN_TXT_PREFIX,
  domainRoutingRecord,
  domainVerificationRecord,
  generateCustomDomainToken,
  isReservedCustomDomain,
  normalizeCustomDomain,
  type TxtLookup,
  verifyCustomDomain,
} from '../../src/custom-domain';
import { resolveHostConfig } from '../../src/hosts';

const CONFIG = resolveHostConfig({ rootDomain: 'docket.place' });
const TOKEN = 'a'.repeat(CUSTOM_DOMAIN_TOKEN_LENGTH);

describe('normalizeCustomDomain', () => {
  it('collapses every spelling of one claim to a single key', () => {
    // If any of these disagreed, the CORE-30 unique constraint would be unenforceable.
    const spellings = [
      'example.com',
      'Example.COM',
      '  example.com  ',
      'example.com.',
      'www.example.com',
      'https://www.Example.com/briefs?x=1',
      'http://example.com:8443',
    ];
    for (const spelling of spellings) {
      expect(normalizeCustomDomain(spelling), spelling).toEqual({ ok: true, host: 'example.com' });
    }
  });

  it('punycodes an internationalized name so both spellings are one claim', () => {
    expect(normalizeCustomDomain('münchen.example')).toEqual({
      ok: true,
      host: 'xn--mnchen-3ya.example',
    });
    expect(normalizeCustomDomain('xn--mnchen-3ya.example')).toEqual({
      ok: true,
      host: 'xn--mnchen-3ya.example',
    });
  });

  it('keeps a subdomain distinct from its apex', () => {
    // `www.` is the only prefix collapsed; treating `briefs.example.com` as `example.com` would
    // hand one workspace a domain another may own.
    expect(normalizeCustomDomain('briefs.example.com')).toEqual({
      ok: true,
      host: 'briefs.example.com',
    });
  });

  it.each([
    [undefined, 'empty'],
    [null, 'empty'],
    ['', 'empty'],
    ['    ', 'empty'],
    ['*.example.com', 'wildcard'],
    ['https://', 'unparsable'],
    ['localhost', 'not-a-domain'],
    ['192.168.1.1', 'not-a-domain'],
    ['[2606:4700::1111]', 'not-a-domain'],
    ['-bad.example.com', 'invalid-label'],
    ['bad-.example.com', 'invalid-label'],
    ['exa_mple.com', 'invalid-label'],
    ['www.', 'not-a-domain'],
  ])('refuses %s with a stable code', (input, reason) => {
    expect(normalizeCustomDomain(input)).toEqual({ ok: false, reason });
  });

  it('refuses names beyond the DNS length limits', () => {
    const longLabel = 'a'.repeat(64);
    expect(normalizeCustomDomain(`${longLabel}.example.com`)).toEqual({
      ok: false,
      reason: 'label-too-long',
    });

    const longHost = `${Array.from({ length: 8 }, () => 'a'.repeat(31)).join('.')}.example.com`;
    expect(longHost.length).toBeGreaterThan(253);
    expect(normalizeCustomDomain(longHost)).toEqual({ ok: false, reason: 'too-long' });
  });
});

describe('isReservedCustomDomain / acceptCustomDomain', () => {
  it('reserves the product apex and everything under it', () => {
    expect(isReservedCustomDomain('docket.place', CONFIG)).toBe(true);
    expect(isReservedCustomDomain('api.docket.place', CONFIG)).toBe(true);
    expect(isReservedCustomDomain('anything.docket.place', CONFIG)).toBe(true);
    expect(isReservedCustomDomain('example.com', CONFIG)).toBe(false);
  });

  it('reserves an off-apex host the product itself serves', () => {
    // A brief host or mail host parked on another domain is still Docket's, and a workspace
    // claiming it would take over a live product surface.
    const split = resolveHostConfig({
      rootDomain: 'docket.place',
      briefHost: 'briefs.example.net',
      athenaInboundMailHost: 'inbox.athena.example.org',
    });
    expect(isReservedCustomDomain('briefs.example.net', split)).toBe(true);
    expect(isReservedCustomDomain('inbox.athena.example.org', split)).toBe(true);
  });

  it('does not reserve everything when no apex is configured', () => {
    expect(isReservedCustomDomain('example.com', resolveHostConfig({}))).toBe(false);
  });

  it('normalizes and reserve-checks in one call', () => {
    expect(acceptCustomDomain('https://WWW.Example.com/', CONFIG)).toEqual({
      ok: true,
      host: 'example.com',
    });
    expect(acceptCustomDomain('api.docket.place', CONFIG)).toEqual({
      ok: false,
      reason: 'reserved',
    });
    expect(acceptCustomDomain('*.example.com', CONFIG)).toEqual({ ok: false, reason: 'wildcard' });
  });
});

describe('generateCustomDomainToken', () => {
  it('produces a fixed-length lowercase hex token', () => {
    const token = generateCustomDomainToken();
    expect(token).toMatch(new RegExp(`^[0-9a-f]{${CUSTOM_DOMAIN_TOKEN_LENGTH}}$`));
  });

  it('is unique per call, so one published record cannot verify a second domain', () => {
    const tokens = new Set(Array.from({ length: 64 }, () => generateCustomDomainToken()));
    expect(tokens.size).toBe(64);
  });

  it('zero-pads low bytes rather than emitting a short token', () => {
    const token = generateCustomDomainToken(
      (count) => new Uint8Array(Array.from({ length: count }, (_unused, i) => i)),
    );
    expect(token).toHaveLength(CUSTOM_DOMAIN_TOKEN_LENGTH);
    expect(token.startsWith('000102')).toBe(true);
  });
});

describe('DNS records shown to the operator', () => {
  it('spells the verification record out exactly', () => {
    expect(domainVerificationRecord('example.com', TOKEN)).toEqual({
      type: 'TXT',
      name: `${CUSTOM_DOMAIN_TXT_LABEL}.example.com`,
      value: `${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}`,
      ttlSeconds: 300,
    });
  });

  it('points the routing record at the configured target', () => {
    expect(domainRoutingRecord('example.com', CONFIG)).toMatchObject({
      type: 'CNAME',
      name: 'example.com',
      value: 'briefs.docket.place',
    });

    const overridden = resolveHostConfig({
      rootDomain: 'docket.place',
      customDomainTarget: 'edge.docket.place',
    });
    expect(domainRoutingRecord('example.com', overridden).value).toBe('edge.docket.place');
  });

  it('refuses to invent a routing target', () => {
    // Publishing a CNAME to a host that does not serve would leave the domain dark while the UI
    // claimed it was set up correctly.
    expect(() => domainRoutingRecord('example.com', resolveHostConfig({}))).toThrow(
      /CUSTOM_DOMAIN_CNAME_TARGET/,
    );
  });
});

describe('verifyCustomDomain', () => {
  const lookupReturning = (entries: readonly (string | readonly string[])[]): TxtLookup =>
    vi.fn().mockResolvedValue(entries);

  it('verifies when the exact token is published', async () => {
    const lookupTxt = lookupReturning([[`${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}`]]);
    const result = await verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt });

    expect(result).toMatchObject({ verified: true, observedCount: 1 });
    expect(result.failure).toBeUndefined();
  });

  it('queries the record name, not the bare host', async () => {
    const lookupTxt = lookupReturning([[`${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}`]]);
    await verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt });
    expect(lookupTxt).toHaveBeenCalledWith(`${CUSTOM_DOMAIN_TXT_LABEL}.example.com`);
  });

  it('rejoins a TXT value the resolver split across 255-byte chunks', async () => {
    const value = `${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}`;
    const lookupTxt = lookupReturning([[value.slice(0, 10), value.slice(10)]]);
    await expect(
      verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt }),
    ).resolves.toMatchObject({ verified: true });
  });

  it('accepts a flat string[] resolver as well as a chunked one', async () => {
    const lookupTxt = lookupReturning([`${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}`]);
    await expect(
      verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt }),
    ).resolves.toMatchObject({ verified: true });
  });

  it('ignores unrelated TXT records at the same name', async () => {
    const lookupTxt = lookupReturning([
      ['v=spf1 include:example.net ~all'],
      ['google-site-verification=whatever'],
      [`${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}`],
    ]);
    await expect(
      verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt }),
    ).resolves.toMatchObject({ verified: true, observedCount: 1 });
  });

  it('reports no-record when nothing of ours is published', async () => {
    const lookupTxt = lookupReturning([['v=spf1 -all']]);
    await expect(
      verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt }),
    ).resolves.toMatchObject({ verified: false, failure: 'no-record', observedCount: 0 });
  });

  it('distinguishes a stale token from a missing one', async () => {
    const lookupTxt = lookupReturning([[`${CUSTOM_DOMAIN_TXT_PREFIX}${'b'.repeat(32)}`]]);
    await expect(
      verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt }),
    ).resolves.toMatchObject({ verified: false, failure: 'token-mismatch', observedCount: 1 });
  });

  it('refuses a token that is merely a substring of the published value', async () => {
    // A prefix/`includes` match would let anyone who can publish one record verify a domain
    // whose token they only partially know.
    const lookupTxt = lookupReturning([[`${CUSTOM_DOMAIN_TXT_PREFIX}${TOKEN}extra`]]);
    await expect(
      verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt }),
    ).resolves.toMatchObject({ verified: false, failure: 'token-mismatch' });
  });

  it('treats a failed lookup as unproved, and swallows the resolver text', async () => {
    const lookupTxt: TxtLookup = vi
      .fn()
      .mockRejectedValue(new Error('queryTxt ENOTFOUND _docket-verify.example.com'));
    const result = await verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt });

    expect(result).toMatchObject({ verified: false, failure: 'lookup-failed', observedCount: 0 });
    // The result carries codes and counts only — never a string a third party controls.
    expect(JSON.stringify(result)).not.toContain('ENOTFOUND');
  });

  it('returns the expected record alongside a failure, so the UI can re-display it', async () => {
    const lookupTxt = lookupReturning([]);
    const result = await verifyCustomDomain({ host: 'example.com', token: TOKEN, lookupTxt });
    expect(result.record).toEqual(domainVerificationRecord('example.com', TOKEN));
  });
});
