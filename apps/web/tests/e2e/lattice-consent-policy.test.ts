import { describe, expect, it } from 'vitest';

import { isProviderConsentUrl } from '../../e2e/lattice/consent-policy';

describe('live Lattice consent popup policy', () => {
  const providerOrigin = 'https://identity.example.com';
  const consentOrigin = 'https://accounts.example.com';
  const bridge = `${providerOrigin}/web-identity/consent`;

  it('accepts the configured Accounts page returning to the selected identity provider', () => {
    const url = new URL(`/consent?return_to=${encodeURIComponent(bridge)}`, consentOrigin);
    expect(isProviderConsentUrl(url, providerOrigin, consentOrigin)).toBe(true);
  });

  it.each([
    `https://other.example.com/consent?return_to=${encodeURIComponent(bridge)}`,
    `${consentOrigin}/login?return_to=${encodeURIComponent(bridge)}`,
    `${consentOrigin}/consent`,
    `${consentOrigin}/consent?return_to=https%3A%2F%2Fother.example.com%2Fweb-identity%2Fconsent`,
    `${consentOrigin}/consent?return_to=${encodeURIComponent(`${providerOrigin}/other`)}`,
  ])('rejects an unrelated popup %s', (candidate) => {
    expect(isProviderConsentUrl(new URL(candidate), providerOrigin, consentOrigin)).toBe(false);
  });
});
