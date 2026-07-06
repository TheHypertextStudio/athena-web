import { describe, expect, it } from 'vitest';

import {
  dedupeNotificationRecipients,
  notificationAudienceSegmentRoleKeys,
  type NotificationRecipientInput,
} from '../src';

describe('notification audience helpers', () => {
  it('deduplicates recipients by user and freezes the reusable recipient snapshot input', () => {
    const recipients: NotificationRecipientInput[] = [
      { userId: 'user_a', organizationId: 'org_1', reason: 'org_member' },
      { userId: 'user_b', organizationId: null, reason: 'explicit' },
      { userId: 'user_a', organizationId: 'org_2', reason: 'segment_match' },
    ];

    const deduped = dedupeNotificationRecipients(recipients);

    expect(deduped).toEqual([
      { userId: 'user_a', organizationId: 'org_1', reason: 'org_member' },
      { userId: 'user_b', organizationId: null, reason: 'explicit' },
    ]);
    expect(Object.isFrozen(deduped)).toBe(true);
    expect(Object.isFrozen(deduped[0])).toBe(true);
  });

  it('centralizes the billing-admin segment role catalog', () => {
    expect(notificationAudienceSegmentRoleKeys('billing_admins')).toEqual([
      'owner',
      'admin',
      'billing_admin',
    ]);
    expect(notificationAudienceSegmentRoleKeys('active_users')).toEqual([]);
  });
});
