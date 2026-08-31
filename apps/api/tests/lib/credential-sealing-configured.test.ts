/**
 * `credentialSealingConfigured` — whether a deployment can seal a credential.
 *
 * @remarks
 * A deployment with no usable `CREDENTIALS_ENCRYPTION_KEY` cannot store a
 * credential at all. Surfaces that would have to store one read this so they can
 * report an unconfigured deployment up front, instead of raising a conflict at
 * the moment somebody acts on them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Re-import the module with `CREDENTIALS_ENCRYPTION_KEY` set to `value`. */
async function withKey(value: string | undefined): Promise<boolean> {
  vi.resetModules();
  if (value === undefined) delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
  else process.env['CREDENTIALS_ENCRYPTION_KEY'] = value;
  const { credentialSealingConfigured } = await import('../../src/lib/credentials');
  return credentialSealingConfigured();
}

describe('credentialSealingConfigured', () => {
  const original = process.env['CREDENTIALS_ENCRYPTION_KEY'];

  beforeEach(() => {
    if (original === undefined) delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
    else process.env['CREDENTIALS_ENCRYPTION_KEY'] = original;
  });

  it('reports a deployment that carries a 32-byte key as able to seal', async () => {
    await expect(withKey(Buffer.from('a'.repeat(32)).toString('base64'))).resolves.toBe(true);
  });

  it('reports an unset key as unable to seal', async () => {
    await expect(withKey(undefined)).resolves.toBe(false);
  });

  it('reports a key of the wrong length as unable to seal', async () => {
    // AES-256-GCM needs exactly 32 bytes; a shorter key would throw at the
    // moment of sealing, which is precisely what this predicate exists to avoid.
    await expect(withKey(Buffer.from('a'.repeat(16)).toString('base64'))).resolves.toBe(false);
  });

  it('reports an empty key as unable to seal', async () => {
    await expect(withKey('')).resolves.toBe(false);
  });
});
