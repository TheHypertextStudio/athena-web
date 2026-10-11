import { PublicConfigOut } from '@docket/identity-access/public-config-contract';
import { z } from 'zod';

/** Optional additions describe the unchanged Node response as well as Workers metadata. */
export type ClientPublicConfig = PublicConfigOut &
  Partial<{
    apiOrigin: string;
    sandboxOrigin: string;
    briefHost: string | null;
  }>;

/** Accept only an absolute HTTP(S) origin without credentials, path or other URL metadata. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:');
  } catch {
    return false;
  }
}

/** Read the same bare normalized hostname shape as validated Worker routing metadata. */
function isHostname(value: string): boolean {
  try {
    const url = new URL(`https://${value}`);
    return value.includes('.') && url.hostname === value && url.origin === `https://${value}`;
  } catch {
    return false;
  }
}

/** Workers require real backend configuration plus every app-owned routing metadata field. */
export const WorkersPublicConfigOut = PublicConfigOut.extend({
  apiOrigin: z.string().refine(isOrigin),
  sandboxOrigin: z.string().refine(isOrigin),
  briefHost: z.string().refine(isHostname).nullable(),
}).loose();
