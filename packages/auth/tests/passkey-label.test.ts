import { describe, expect, it } from 'vitest';

import { derivePasskeyLabel } from '../src/passkey-label';

describe('derivePasskeyLabel', () => {
  it('uses the authenticator catalog when WebAuthn provides a known AAGUID', () => {
    expect(
      derivePasskeyLabel({
        aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
        userAgent: 'custom-client',
      }),
    ).toBe('Apple Passwords');
  });

  it('uses the browser and operating system when the authenticator is unknown', () => {
    expect(
      derivePasskeyLabel({
        aaguid: '00000000-0000-0000-0000-000000000000',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      }),
    ).toBe('Chrome on macOS');
  });

  it('keeps a browser-only fallback useful', () => {
    expect(
      derivePasskeyLabel({
        userAgent: 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
      }),
    ).toBe('Chrome');
  });

  it('keeps an operating-system-only fallback useful', () => {
    expect(
      derivePasskeyLabel({
        userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
      }),
    ).toBe('macOS');
  });

  it.each([undefined, null, '', ' ', 'custom-client'])(
    'falls back to the authenticator kind when the User-Agent is %j',
    (userAgent) => {
      expect(
        derivePasskeyLabel({
          userAgent,
          transports: ['usb'],
        }),
      ).toBe('Security key');
    },
  );
});
