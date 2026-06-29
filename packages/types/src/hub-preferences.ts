/**
 * `@docket/types` — the canonical Zod source for Hub preferences.
 */
import { z } from 'zod';

/** Where the Hub lands on open: the Hub, the last-used context, or a specific org. */
export const HubLanding = z.union([
  z.literal('hub'),
  z.literal('last'),
  z.object({ orgId: z.string() }),
]);
/** Hub landing value. */
export type HubLanding = z.infer<typeof HubLanding>;

/** Personal Hub preferences. */
export const HubPreferences = z.object({
  /** Landing surface on open. */
  landing: HubLanding.optional(),
  /** Row density. */
  density: z.enum(['comfortable', 'compact']).optional(),
  /** Theme preference. */
  theme: z.enum(['system', 'light', 'dark']).optional(),
  /** IANA timezone for the daily plan (also the digest's day boundary + send time). */
  timezone: z.string().optional(),
  /** Daily digest delivery settings (the Sunsama-style end-of-day summary). */
  digest: z
    .object({
      /** Whether the daily digest is generated and delivered. */
      enabled: z.boolean().optional(),
      /** Local clock time to send, `"HH:MM"` 24-hour (interpreted in {@link timezone}). */
      sendAtLocalTime: z.string().optional(),
      /** Where to deliver the digest. */
      channels: z.array(z.enum(['email', 'inApp'])).optional(),
    })
    .optional(),
});
/** Hub preferences value. */
export type HubPreferences = z.infer<typeof HubPreferences>;
