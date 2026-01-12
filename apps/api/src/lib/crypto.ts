/**
 * Encryption helpers for sensitive data at rest.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { env } from './env.js';

const ENCRYPTION_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer | null {
  const key = env.DATA_ENCRYPTION_KEY;
  if (!key) {
    return null;
  }

  const buffer = Buffer.from(key, 'base64');
  if (buffer.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64-encoded)');
  }

  return buffer;
}

function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}

/**
 * Encrypt a secret string for storage.
 *
 * @param value - Plaintext secret to encrypt.
 * @returns Encrypted value prefixed with the version marker, or the original value when encryption is disabled.
 */
export function encryptSecret(value: string): string {
  if (isEncrypted(value)) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    return value;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');

  return `${ENCRYPTION_PREFIX}${payload}`;
}

/**
 * Decrypt a stored secret string.
 *
 * @param value - Encrypted secret value.
 * @returns Decrypted plaintext value.
 * @throws {Error} When the encryption key is missing or the payload is invalid.
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('DATA_ENCRYPTION_KEY is required to decrypt stored secrets');
  }

  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Decrypt an optional secret string.
 *
 * @param value - Encrypted secret value or undefined.
 * @returns Decrypted plaintext value or undefined when no value is provided.
 */
export function decryptSecretOptional(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return decryptSecret(value);
}
