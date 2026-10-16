import { BlueprintError } from '../blueprints/errors';
import { copyFacts } from './copy-facts';

// The portable Work domain intentionally has ES-only type libraries. Describe only the native
// Web Crypto/UTF-8 surface needed here, rather than importing Node or browser implementation types.
interface FingerprintPlatform {
  readonly crypto?: {
    readonly subtle: { digest(algorithm: string, bytes: Uint8Array): Promise<ArrayBuffer> };
  };
  readonly TextEncoder?: new () => { encode(value: string): Uint8Array };
}
/** Hash complete normalized copy facts with the runtime's native SHA-256, without I/O or identity allocation. */
export async function fingerprintCopyFacts(facts: unknown): Promise<string> {
  const platform = globalThis as unknown as FingerprintPlatform;
  if (!platform.crypto?.subtle || !platform.TextEncoder)
    throw new BlueprintError('blueprint_invalid', 'Copy review requires native SHA-256 support.');
  const digest = await platform.crypto.subtle.digest(
    'SHA-256',
    new platform.TextEncoder().encode(copyFacts(facts)),
  );
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
