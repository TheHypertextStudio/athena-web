/**
 * Product-support contact follows the configured product host. Official legal and privacy
 * contacts are defined separately in `legal-policy.ts` and stay with the Studio.
 */
import { env } from '@docket/env/web';

/**
 * Public product-support address, resolved once at module load.
 * `NEXT_PUBLIC_SUPPORT_EMAIL` overrides the address derived from `NEXT_PUBLIC_APP_URL`.
 * Both values are public build-time configuration; the required app URL keeps the link valid.
 */
export const SUPPORT_EMAIL: string = (() => {
  const configured = env.NEXT_PUBLIC_SUPPORT_EMAIL;
  if (configured !== undefined) return configured;
  return `support@${new URL(env.NEXT_PUBLIC_APP_URL).hostname.replace(/^www\./, '')}`;
})();

/** General product inquiries use the contact mailbox at the configured product apex. */
export const CONTACT_EMAIL = `contact@${new URL(env.NEXT_PUBLIC_APP_URL).hostname.replace(/^www\./, '')}`;
