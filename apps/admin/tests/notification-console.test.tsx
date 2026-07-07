import { Id } from '@docket/types';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { notificationDraftToCreateInput } from '../src/app/(admin)/notifications/notification-console-model';
import { NotificationAnnouncementConsole } from '../src/app/(admin)/notifications/notification-console';
import type { AdminNotificationIntent } from '../src/lib/types';

const intent: AdminNotificationIntent = {
  id: Id.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  senderType: 'staff',
  senderId: null,
  organizationId: null,
  category: 'service_announcement',
  priority: 'normal',
  audience: { type: 'user', userId: 'user_1' },
  channels: ['web', 'email'],
  subject: 'Scheduled maintenance tonight',
  body: {
    text: 'Docket will be briefly unavailable tonight.',
    html: '<p>Docket will be briefly unavailable tonight.</p>',
  },
  replyPolicy: 'staff_inbox',
  status: 'draft',
  scheduledAt: null,
  createdAt: '2026-07-07T08:00:00.000Z',
  createdBy: 'staff_1',
};

describe('NotificationAnnouncementConsole', () => {
  it('renders the compose through monitor safety flow for a selected announcement', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationAnnouncementConsole, {
        intents: [intent],
        selectedIntent: intent,
        estimate: {
          recipientCount: 1,
          channelCounts: {
            web: { send: 1, delay: 0, suppress: 0 },
            email: { send: 0, delay: 0, suppress: 1 },
            sms: { send: 0, delay: 0, suppress: 0 },
            push: { send: 0, delay: 0, suppress: 0 },
          },
          suppressions: [{ channel: 'email', reason: 'no_verified_contact_point', count: 1 }],
          approvalRequired: false,
          approvalReasons: [],
        },
        preview: {
          subject: 'Scheduled maintenance tonight',
          replyPolicy: 'staff_inbox',
          web: {
            title: 'Scheduled maintenance tonight',
            body: 'Docket will be briefly unavailable tonight.',
          },
          email: {
            subject: 'Scheduled maintenance tonight',
            text: 'Docket will be briefly unavailable tonight.',
            html: '<p>Docket will be briefly unavailable tonight.</p>',
          },
        },
        deliveries: [{ id: 'del_1', channel: 'web', status: 'sent' }],
        inboundEvents: [{ id: 'in_1', channel: 'email', kind: 'replied' }],
        auditEvents: [{ id: 'audit_1', type: 'notification.approved' }],
        draft: {
          subject: 'Scheduled maintenance tonight',
          bodyText: 'Docket will be briefly unavailable tonight.',
          audienceType: 'user',
          audienceValue: 'user_1',
          channels: ['web', 'email'],
          priority: 'normal',
          replyPolicy: 'staff_inbox',
          scheduledAt: '',
        },
        pendingAction: null,
        error: null,
        statusMessage: 'Preview refreshed',
        onDraftChange: vi.fn(),
        onCreateDraft: vi.fn(),
        onRefreshReview: vi.fn(),
        onTestSend: vi.fn(),
        onApprove: vi.fn(),
        onSendNow: vi.fn(),
        onCancel: vi.fn(),
        onSelectIntent: vi.fn(),
      }),
    );

    expect(html).toContain('Service announcements');
    expect(html).toContain('Compose');
    expect(html).toContain('Audience');
    expect(html).toContain('Channels');
    expect(html).toContain('Preview');
    expect(html).toContain('Review');
    expect(html).toContain('Monitor');
    expect(html).toContain('Scheduled maintenance tonight');
    expect(html).toContain('1 recipient');
    expect(html).toContain('no verified contact point');
    expect(html).toContain('Test send');
    expect(html).toContain('Approve');
    expect(html).toContain('Send now');
    expect(html).toContain('Cancel');
    expect(html).toContain('notification.approved');
    expect(html).toContain('replied');
    expect(html).toContain('Preview refreshed');
  });

  it('serializes staff draft fields into a notification-intent create body', () => {
    expect(
      notificationDraftToCreateInput({
        subject: 'Scheduled maintenance tonight',
        bodyText: 'Docket will be briefly unavailable tonight.',
        audienceType: 'users',
        audienceValue: 'user_1, user_2',
        channels: ['web', 'email'],
        priority: 'high',
        replyPolicy: 'staff_inbox',
        scheduledAt: '2026-07-08T05:00',
      }),
    ).toMatchObject({
      senderType: 'staff',
      category: 'service_announcement',
      priority: 'high',
      audience: { type: 'users', userIds: ['user_1', 'user_2'] },
      channels: ['web', 'email'],
      subject: 'Scheduled maintenance tonight',
      body: { text: 'Docket will be briefly unavailable tonight.' },
      replyPolicy: 'staff_inbox',
      scheduledAt: '2026-07-08T05:00:00.000Z',
    });
  });
});
