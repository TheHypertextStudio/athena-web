import { z } from 'zod';

/** Calendar date without a time or timezone. */
export const DateString = z.iso
  .date()
  .describe('A calendar date with no time component, ISO-8601 `YYYY-MM-DD`.')
  .meta({ example: '2026-06-29' });
/** Calendar date value. */
export type DateString = z.infer<typeof DateString>;

/** ISO 8601 timestamp with an explicit timezone. */
export const TimestampString = z.iso.datetime().brand<'TimestampString'>();
/** Timestamp value. */
export type TimestampString = z.infer<typeof TimestampString>;
