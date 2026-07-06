import { z } from 'zod';

import { Id } from '@docket/types';
import { ContactPointStatus, ContactPointType } from './enums';
import { NotificationInstant } from './shared';

/** Create a user contact point. */
export const ContactPointCreate = z
  .object({
    type: ContactPointType,
    value: z.string().trim().min(1),
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
    id: Id,
    userId: z.string().min(1),
    type: ContactPointType,
    valueMasked: z.string().min(1),
    status: ContactPointStatus,
    primary: z.boolean(),
    verifiedAt: NotificationInstant.nullable().optional(),
    disabledAt: NotificationInstant.nullable().optional(),
    createdAt: NotificationInstant,
  })
  .meta({
    id: 'ContactPointOut',
    description: 'A verified or pending notification contact point.',
  });
/** Contact-point representation value. */
export type ContactPointOut = z.infer<typeof ContactPointOut>;
