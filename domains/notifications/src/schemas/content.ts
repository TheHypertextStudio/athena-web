import { z } from 'zod';

/** Content carried by a notification intent. */
export const NotificationContent = z
  .looseObject({
    text: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.text === undefined && body.html === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one of `text` or `html` is required.',
        path: ['text'],
      });
    }
  })
  .meta({ id: 'NotificationContent', description: 'Notification text/html body content.' });
/** Notification-content value. */
export type NotificationContent = z.infer<typeof NotificationContent>;
