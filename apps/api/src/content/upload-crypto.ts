import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../env';

function key(): Buffer {
  if (!env.BETTER_AUTH_SECRET)
    throw new Error('Upload capability encryption requires the runtime secret');
  return Buffer.from(
    hkdfSync('sha256', env.BETTER_AUTH_SECRET, 'docket-file-upload-v1', 'capability', 32),
  );
}
/** Seal a provider URI or local token, bound to its reserved session identity. */
export function sealUploadCapability(id: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(id));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
}
/** Authenticate and decrypt a capability; never return provider text in an error. */
export function openUploadCapability(id: string, value: string): string {
  const bytes = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
