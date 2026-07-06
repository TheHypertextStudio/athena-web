import { z } from 'zod';

/** ISO-8601 instant schema shared by notification service DTOs. */
export const NotificationInstant = z.iso.datetime();
/** ISO-8601 instant value used by notification service DTOs. */
export type NotificationInstant = z.infer<typeof NotificationInstant>;
