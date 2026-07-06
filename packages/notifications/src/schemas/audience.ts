import { z } from 'zod';

import { OrganizationId } from '@docket/types';

/** Supported notification audience selectors. */
export const NotificationAudience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), userId: z.string().min(1) }),
  z.object({ type: z.literal('users'), userIds: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('organization'), organizationId: OrganizationId }),
  z.object({ type: z.literal('all_users') }),
  z.object({
    type: z.literal('segment'),
    segment: z.enum([
      'active_users',
      'trial_users',
      'billing_admins',
      'users_with_bounced_email',
      'users_without_verified_phone',
    ]),
  }),
]);
/** Notification-audience value. */
export type NotificationAudience = z.infer<typeof NotificationAudience>;
