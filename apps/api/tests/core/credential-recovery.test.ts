import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { env } from '../../src/env';
import { CredentialReauthRequiredError } from '../../src/error';
import { sealCredential, unsealCredential } from '../../src/lib/credentials';

describe('unsealCredential', () => {
  it('throws CredentialReauthRequiredError when decrypted under a rotated key', () => {
    const mutableEnv = env as { CREDENTIALS_ENCRYPTION_KEY?: string | undefined };
    const previous = mutableEnv.CREDENTIALS_ENCRYPTION_KEY;
    const keyA = randomBytes(32).toString('base64');
    const keyB = randomBytes(32).toString('base64');

    try {
      mutableEnv.CREDENTIALS_ENCRYPTION_KEY = keyA;
      const envelope = sealCredential('secret-token-value');

      mutableEnv.CREDENTIALS_ENCRYPTION_KEY = keyB;
      expect(() => unsealCredential(envelope)).toThrow(CredentialReauthRequiredError);
      try {
        unsealCredential(envelope);
      } catch (error) {
        expect(error).toBeInstanceOf(CredentialReauthRequiredError);
        expect((error as CredentialReauthRequiredError).code).toBe('credential_reauth_required');
        expect((error as CredentialReauthRequiredError).status).toBe(409);
      }
    } finally {
      mutableEnv.CREDENTIALS_ENCRYPTION_KEY = previous;
    }
  });
});
