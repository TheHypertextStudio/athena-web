import { z } from 'zod';

/** Internal route an inbox announcement can open, without external or script navigation. */
export const NotificationWebUrl = z
  .string()
  .regex(/^\/(?![\\/])[^\\\s]*$/u, 'Use an internal route such as /terms.');

/** Content carried by a notification intent. */
export const NotificationContent = z
  .looseObject({
    webUrl: NotificationWebUrl.optional(),
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
