import { describe, expect, it } from 'vitest';

import {
  canCreateNotification,
  categoryAllowsChannel,
  lockedPreference,
  requiresApproval,
} from '../src';
import { makeNotificationIntentCreateFixture, notificationAudienceFixtures } from '../src/testing';

describe('notification policy', () => {
  it('allows all-users announcements only from staff senders', () => {
    const staffDecision = canCreateNotification(
      makeNotificationIntentCreateFixture({
        senderType: 'staff',
        audience: notificationAudienceFixtures.allUsers,
      }),
    );
    expect(staffDecision.allowed).toBe(true);

    const systemDecision = canCreateNotification(
      makeNotificationIntentCreateFixture({
        senderType: 'system',
        audience: notificationAudienceFixtures.allUsers,
      }),
    );
    expect(systemDecision.allowed).toBe(false);
    expect(systemDecision.denialReasons).toContain('all_users_requires_staff_sender');
  });

  it('limits security and account categories to system or staff senders', () => {
    for (const category of ['security', 'account'] as const) {
      expect(
        canCreateNotification(
          makeNotificationIntentCreateFixture({ senderType: 'system', category }),
        ).allowed,
      ).toBe(true);
      expect(
        canCreateNotification(
          makeNotificationIntentCreateFixture({ senderType: 'staff', category }),
        ).allowed,
      ).toBe(true);

      const orgDecision = canCreateNotification(
        makeNotificationIntentCreateFixture({ senderType: 'org', category }),
      );
      expect(orgDecision.allowed).toBe(false);
      expect(orgDecision.denialReasons).toContain('category_requires_system_or_staff_sender');
    }
  });

  it('requires staff approval for multi-recipient SMS sends', () => {
    const approval = requiresApproval(
      makeNotificationIntentCreateFixture({
        audience: notificationAudienceFixtures.users,
        channels: ['sms'],
      }),
    );

    expect(approval.required).toBe(true);
    expect(approval.reasons).toContain('sms_multi_recipient');
    expect(approval.approver).toBe('staff');
  });

  it('does not allow marketing to ride service-announcement channels', () => {
    for (const channel of ['web', 'email', 'sms', 'push'] as const) {
      expect(categoryAllowsChannel('marketing', channel)).toBe(false);
    }

    const decision = canCreateNotification(
      makeNotificationIntentCreateFixture({ category: 'marketing', channels: ['email'] }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.denialReasons).toContain('marketing_requires_dedicated_consent_surface');
  });

  it('allows web delivery for every non-marketing category', () => {
    for (const category of [
      'security',
      'account',
      'service_announcement',
      'workflow',
      'digest',
      'billing',
    ] as const) {
      expect(categoryAllowsChannel(category, 'web')).toBe(true);
    }
  });

  it('locks safety-critical preference categories', () => {
    expect(lockedPreference('security')).toBe(true);
    expect(lockedPreference('account')).toBe(true);
    expect(lockedPreference('service_announcement')).toBe(false);
  });
});
