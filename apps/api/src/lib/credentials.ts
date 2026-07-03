/**
 * `@docket/api` — org-credential sealing (AES-256-GCM).
 *
 * @remarks
 * Seals the bearer tokens behind `integration_credential.ciphertext` so the database
 * never holds a remote-service secret in plaintext. Envelope: `v1:gcm:<iv>:<tag>:<data>`
 * (base64url segments). The key is the explicit `CREDENTIALS_ENCRYPTION_KEY` env value
 * (base64, exactly 32 bytes decoded) — there is deliberately no fallback key: callers
 * that need to store a credential fail clearly when it is unset.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ConflictError } from '../error';
import { env } from '../env';

const ENVELOPE_PREFIX = 'v1:gcm';

/** Decode + validate the configured sealing key, or throw a clear 409. */
function sealingKey(): Buffer {
  const raw = env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new ConflictError(
      'CREDENTIALS_ENCRYPTION_KEY is not configured; refusing to store a credential',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConflictError('CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/**
 * Seal a secret into the storable envelope.
 *
 * @param plaintext - The secret to seal.
 * @returns the `v1:gcm:<iv>:<tag>:<data>` envelope.
 */
export function sealCredential(plaintext: string): string {
  const key = sealingKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join(':');
}

/**
 * Unseal a stored envelope back into the secret.
 *
 * @param envelope - The `v1:gcm:<iv>:<tag>:<data>` ciphertext.
 * @returns the plaintext secret.
 * @throws {ConflictError} When the envelope is malformed or fails authentication.
 */
export function unsealCredential(envelope: string): string {
  const [v, mode, ivB64, tagB64, dataB64] = envelope.split(':');
  if (!ivB64 || !tagB64 || !dataB64 || `${v ?? ''}:${mode ?? ''}` !== ENVELOPE_PREFIX) {
    throw new ConflictError('Malformed credential envelope');
  }
  const key = sealingKey();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ConflictError('Credential envelope failed authentication');
  }
}
