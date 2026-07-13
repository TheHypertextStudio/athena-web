/**
 * `@docket/types` — the canonical Zod source for Hub preferences.
 */
import { z } from 'zod';

import { CalendarItemCreateIntent } from './calendar';
import { CalendarLayerId } from './primitives';

/** Where the Hub lands on open: the Hub, the last-used context, or a specific org. */
export const HubLanding = z
  .union([z.literal('hub'), z.literal('last'), z.object({ orgId: z.string() })])
  .describe(
    'The surface the Hub opens to. `"hub"`: the cross-org Hub home. `"last"`: the most recently used context. `{ orgId }`: always land in a specific org.',
  );
/** Hub landing value. */
export type HubLanding = z.infer<typeof HubLanding>;

/** Continuous scheduling-canvas preferences and quick-create defaults. */
export const CalendarPreferences = z
  .object({
    pixelsPerHour: z
      .number()
      .min(24)
      .max(240)
      .optional()
      .describe('Continuous vertical zoom in pixels per hour (default: 72).'),
    minLaneWidth: z
      .number()
      .min(160)
      .max(640)
      .optional()
      .describe('Minimum date-lane width in pixels before horizontal scrolling (default: 240).'),
    defaultCreateIntent: CalendarItemCreateIntent.optional().describe(
      'Whether new selected regions default to events or timeboxes (default: event).',
    ),
    defaultLayerId: CalendarLayerId.nullable()
      .optional()
      .describe(
        'Preferred destination layer for new events, whether native or writable provider-backed; null returns to the Docket fallback.',
      ),
  })
  .describe('Personal defaults for the continuous scheduling canvas.');
/** Calendar preferences value. */
export type CalendarPreferences = z.infer<typeof CalendarPreferences>;

/** Personal Hub preferences. */
export const HubPreferences = z
  .object({
    landing: HubLanding.optional().describe('Where the Hub lands on open (default: the Hub home).'),
    density: z
      .enum(['comfortable', 'compact'])
      .optional()
      .describe('Row density for lists. `comfortable`: roomier; `compact`: denser.'),
    theme: z
      .enum(['system', 'light', 'dark'])
      .optional()
      .describe('Color theme. `system` follows the OS setting; `light`/`dark` force one.'),
    timezone: z
      .string()
      .optional()
      .describe(
        "IANA timezone (e.g. `America/Chicago`) anchoring the daily plan — also the digest's day boundary and send time.",
      ),
    calendar: CalendarPreferences.optional().describe('Continuous calendar-canvas preferences.'),
    digest: z
      .object({
        enabled: z
          .boolean()
          .optional()
          .describe('Whether the daily digest is generated and delivered.'),
        sendAtLocalTime: z
          .string()
          .optional()
          .describe('Local clock time to send, `"HH:MM"` 24-hour, interpreted in `timezone`.'),
        channels: z
          .array(z.enum(['email', 'inApp']))
          .optional()
          .describe('Where to deliver the digest: any of `email`, `inApp`.'),
      })
      .optional()
      .describe('Daily-digest delivery settings (the Sunsama-style end-of-day summary).'),
    proactive: z
      .object({
        enabled: z
          .boolean()
          .optional()
          .describe(
            'When true, a mention/assignment observation spawns an approval-gated agent plan.',
          ),
      })
      .optional()
      .describe(
        'Proactive-agent settings — whether incoming mentions/assignments auto-draft a plan.',
      ),
  })
  .describe(
    "A user's personal Hub preferences (cross-org UI + daily-plan/digest/proactive settings).",
  );
/** Hub preferences value. */
export type HubPreferences = z.infer<typeof HubPreferences>;
