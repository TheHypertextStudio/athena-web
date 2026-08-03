import { afterEach, describe, expect, it, vi } from 'vitest';

import { dragSourceProps } from '../../src/lib/draggable';
import { getOrgAccent, ORG_ACCENT_PALETTE } from '../../src/lib/org-accent';
import { STRETCHED_LINK } from '../../src/lib/stretched-link';
import { cn } from '../../src/lib/utils';
import {
  isConditionalMediationSupported,
  isWebAuthnSupported,
  signalUnknownPasskey,
} from '../../src/lib/webauthn';

describe('cn', () => {
  it('joins truthy class names and drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('de-duplicates conflicting Tailwind utilities, keeping the last', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('returns an empty string for no inputs', () => {
    expect(cn()).toBe('');
  });
});

describe('getOrgAccent', () => {
  it('returns a palette entry for an org id', () => {
    const accent = getOrgAccent('ORG00000000000000000000001');
    expect(ORG_ACCENT_PALETTE).toContain(accent);
  });

  it('is deterministic for the same id', () => {
    expect(getOrgAccent('same-id')).toBe(getOrgAccent('same-id'));
  });

  it('distributes ids across the whole palette', () => {
    const seen = new Set<string>();
    // FNV-1a over many distinct ids should hit every palette bucket.
    for (let i = 0; i < 500; i++) {
      seen.add(getOrgAccent(`org-${String(i)}`));
    }
    expect(seen.size).toBe(ORG_ACCENT_PALETTE.length);
  });

  it('returns a valid palette color for the empty string', () => {
    // `% palette.length` always selects a real entry; the undefined-guard is unreachable.
    const accent = getOrgAccent('');
    expect(ORG_ACCENT_PALETTE).toContain(accent);
  });
});

describe('STRETCHED_LINK', () => {
  it('stretches an absolutely-positioned, empty-content overlay', () => {
    expect(STRETCHED_LINK).toContain('after:absolute');
    expect(STRETCHED_LINK).toContain('after:inset-0');
  });
});

describe('dragSourceProps onDragEnd', () => {
  it('includes onDragEnd when the source supplies cleanup', () => {
    const onDragEnd = vi.fn();
    const props = dragSourceProps({ onDragStart: vi.fn(), onDragEnd });
    expect(props?.onDragEnd).toBe(onDragEnd);
  });
});

/**
 * jsdom implements neither `window.PublicKeyCredential` nor `navigator.credentials`, so every
 * "supported" path in `webauthn.ts` has to stub both onto the real globals for the duration of a
 * test and remove them afterward — there is no `vi.stubGlobal('navigator', …)` shortcut, because
 * replacing the whole `navigator` object would break anything else reading off it in the same
 * environment.
 */
function stubPublicKeyCredential(value: unknown): void {
  vi.stubGlobal('PublicKeyCredential', value);
  Object.defineProperty(navigator, 'credentials', { value: {}, configurable: true });
}

function restoreWebAuthnGlobals(): void {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'credentials');
}

describe('isWebAuthnSupported', () => {
  afterEach(restoreWebAuthnGlobals);

  it('is true when the browser exposes PublicKeyCredential + navigator.credentials', () => {
    stubPublicKeyCredential(function PublicKeyCredential() {
      /* stub constructor */
    });
    expect(isWebAuthnSupported()).toBe(true);
  });

  it('is false when PublicKeyCredential is absent', () => {
    expect(isWebAuthnSupported()).toBe(false);
  });
});

describe('isConditionalMediationSupported', () => {
  afterEach(restoreWebAuthnGlobals);

  it('resolves false when WebAuthn itself is unsupported', async () => {
    await expect(isConditionalMediationSupported()).resolves.toBe(false);
  });

  it('resolves false when isConditionalMediationAvailable is not a function', async () => {
    stubPublicKeyCredential(function PublicKeyCredential() {
      /* stub constructor */
    });
    await expect(isConditionalMediationSupported()).resolves.toBe(false);
  });

  it('resolves the browser answer when the method is present', async () => {
    function PKC(): void {
      /* stub constructor */
    }
    PKC.isConditionalMediationAvailable = vi.fn().mockResolvedValue(true);
    stubPublicKeyCredential(PKC);
    await expect(isConditionalMediationSupported()).resolves.toBe(true);
  });

  it('resolves false rather than throwing when the browser call rejects', async () => {
    function PKC(): void {
      /* stub constructor */
    }
    PKC.isConditionalMediationAvailable = vi.fn().mockRejectedValue(new Error('boom'));
    stubPublicKeyCredential(PKC);
    await expect(isConditionalMediationSupported()).resolves.toBe(false);
  });
});

describe('signalUnknownPasskey', () => {
  afterEach(restoreWebAuthnGlobals);

  it('is a no-op when WebAuthn is unsupported', async () => {
    await expect(signalUnknownPasskey('cred-1', 'docket.example')).resolves.toBeUndefined();
  });

  it('is a no-op when the Signal API method is absent', async () => {
    stubPublicKeyCredential(function PublicKeyCredential() {
      /* stub constructor */
    });
    await expect(signalUnknownPasskey('cred-1', 'docket.example')).resolves.toBeUndefined();
  });

  it('calls signalUnknownCredential with the credential id and relying-party id', async () => {
    const signalUnknownCredential = vi.fn().mockResolvedValue(undefined);
    function PKC(): void {
      /* stub constructor */
    }
    PKC.signalUnknownCredential = signalUnknownCredential;
    stubPublicKeyCredential(PKC);
    await signalUnknownPasskey('cred-1', 'docket.example');
    expect(signalUnknownCredential).toHaveBeenCalledWith({
      rpId: 'docket.example',
      credentialId: 'cred-1',
    });
  });

  it('swallows a Signal API failure — best-effort cleanup must never throw', async () => {
    function PKC(): void {
      /* stub constructor */
    }
    PKC.signalUnknownCredential = vi.fn().mockRejectedValue(new Error('boom'));
    stubPublicKeyCredential(PKC);
    await expect(signalUnknownPasskey('cred-1', 'docket.example')).resolves.toBeUndefined();
  });
});
