import { z } from 'zod';

/** Provider-specific event categories normalized independently of provider naming conventions. */
export const CalendarProviderEventType = z
  .enum(['default', 'out_of_office', 'focus_time', 'working_location', 'birthday', 'from_gmail'])
  .meta({
    id: 'CalendarProviderEventType',
    description:
      'A recognized provider event category normalized independently of provider naming conventions.',
  });
/** Calendar provider-event-type value. */
export type CalendarProviderEventType = z.infer<typeof CalendarProviderEventType>;

/** Optional busy/free fact; omitted legacy values retain the provider's busy default. */
export const CalendarBlocksTime = z
  .boolean()
  .optional()
  .describe('Whether this item reserves time.');
