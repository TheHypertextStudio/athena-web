import { z } from 'zod';

/** Work-view-local ISO date operand. */
export const DateString = z.iso
  .date()
  .describe('A calendar date with no time component, ISO-8601 `YYYY-MM-DD`.')
  .meta({ example: '2026-06-29' });
/** Work-view-local ISO timestamp operand. */
export const TimestampString = z.iso.datetime().brand<'TimestampString'>();
