import { z } from 'zod';

import { ContactPointId } from '../ids';
import { ContactPointStatus, ContactPointType } from './enums';
import { NotificationInstant } from './shared';

/** Create a user contact point. */
export const ContactPointCreate = z
  .object({
    type: ContactPointType,
    value: z.string().trim().min(1),
    purpose: z.enum(['sms_notifications', 'email_notifications', 'push_notifications']).optional(),
  })
  .meta({ id: 'ContactPointCreate', description: 'Create a notification contact point.' });
/** Contact-point-create value. */
export type ContactPointCreate = z.infer<typeof ContactPointCreate>;

/** Verify a pending contact point. */
export const ContactPointVerify = z
  .object({
    code: z.string().trim().min(1).max(32),
  })
  .meta({ id: 'ContactPointVerify', description: 'Verify a pending contact point.' });
/** Contact-point-verify value. */
export type ContactPointVerify = z.infer<typeof ContactPointVerify>;

/** User contact point representation. */
export const ContactPointOut = z
  .object({
    id: ContactPointId,
    userId: z.string().min(1),
    type: ContactPointType,
    value: z
      .string()
      .min(1)
      .describe(
        'The email address or phone number for this contact point. Docket returns the full value only to the account that owns it. Delivery records use a masked value instead.',
      ),
    status: ContactPointStatus,
    primary: z.boolean(),
    verifiedAt: NotificationInstant.nullable(),
    disabledAt: NotificationInstant.nullable(),
    createdAt: NotificationInstant,
  })
  .meta({
    id: 'ContactPointOut',
    description: 'A verified or pending notification contact point.',
  });
/** Contact-point representation value. */
export type ContactPointOut = z.infer<typeof ContactPointOut>;
