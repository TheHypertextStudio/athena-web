import '@testing-library/jest-dom/vitest';

import { NotificationId, OrganizationId, type NotificationOut } from '@docket/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useInboxPage } = vi.hoisted(() => ({
  useInboxPage: vi.fn(),
}));

vi.mock('../../../src/app/(app)/inbox/use-inbox-page', () => ({
  useInboxPage,
}));

vi.mock('../../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    orgName: () => 'Civic Ops',
  }),
}));

import InboxClient from '../../../src/app/(app)/inbox/inbox-client';

const ORG_ID = OrganizationId.parse('01F8MECHZX3TBDSZ7XRADM79XV');
const NOTICE_ID = NotificationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const APPROVAL_ID = NotificationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function notification(overrides: Partial<NotificationOut>): NotificationOut {
  return {
    id: NOTICE_ID,
    userId: 'user_1',
    organizationId: ORG_ID,
    type: 'mention',
    body: { title: 'A teammate mentioned you' },
    readAt: null,
    createdAt: '2026-07-07T17:00:00.000Z',
    ...overrides,
  };
}

function renderInbox(
  notifications: readonly NotificationOut[],
  options: { readonly tab?: string } = {},
): void {
  useInboxPage.mockReturnValue({
    tab: options.tab ?? 'all',
    setTab: vi.fn(),
    orderedInbox: notifications,
    activity: [],
    unreadCount: notifications.filter((n) => !n.readAt).length,
    pendingApprovals: notifications.filter((n) => n.type === 'approval_request' && !n.readAt)
      .length,
    loading: false,
    error: null,
    actionError: null,
    pendingIds: new Set<string>(),
    markingAll: false,
    segments: [
      { id: 'all', label: 'All', count: notifications.length },
      {
        id: 'unread',
        label: 'Unread',
        count: notifications.filter((n) => !n.readAt).length,
      },
      {
        id: 'needs_action',
        label: 'Needs action',
        count: notifications.filter((n) => n.type === 'approval_request' && !n.readAt).length,
      },
      {
        id: 'announcements',
        label: 'Announcements',
        count: notifications.filter((n) => n.type === 'service_announcement').length,
      },
      {
        id: 'mentions',
        label: 'Mentions & assignments',
        count: notifications.filter((n) => n.type === 'mention' || n.type === 'assignment').length,
      },
      { id: 'activity', label: 'Activity' },
    ],
    refetch: vi.fn(),
    onApprove: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
  });

  render(<InboxClient />);
}

describe('InboxClient notification UX', () => {
  it('groups approval requests under Needs action before the rest of the inbox', () => {
    renderInbox([
      notification({
        id: NOTICE_ID,
        type: 'service_announcement',
        body: { title: 'Scheduled maintenance' },
      }),
      notification({
        id: APPROVAL_ID,
        type: 'approval_request',
        body: { title: 'Approve a low-risk agent action' },
      }),
    ]);

    const text = document.body.textContent;
    expect(text.indexOf('Needs action')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Updates')).toBeGreaterThan(text.indexOf('Needs action'));
    expect(text.indexOf('Approve a low-risk agent action')).toBeGreaterThan(
      text.indexOf('Needs action'),
    );
    expect(text.indexOf('Scheduled maintenance')).toBeGreaterThan(text.indexOf('Updates'));
  });

  it('shows cross-channel delivery hints on service announcements', () => {
    renderInbox([
      notification({
        id: NOTICE_ID,
        type: 'service_announcement',
        body: {
          title: 'Scheduled maintenance',
          deliveryChannels: [
            { channel: 'web', status: 'sent' },
            { channel: 'email', status: 'delivered', valueMasked: 'a***@x.test' },
          ],
        },
      }),
    ]);

    expect(screen.getByText('Service announcement')).toBeInTheDocument();
    expect(screen.getByText('Also emailed')).toBeInTheDocument();
    expect(screen.getByText('a***@x.test')).toBeInTheDocument();
  });

  it('filters the inbox into Slack-like attention slices', () => {
    renderInbox(
      [
        notification({
          id: NOTICE_ID,
          type: 'service_announcement',
          body: { title: 'Scheduled maintenance' },
          readAt: '2026-07-07T18:00:00.000Z',
        }),
        notification({
          id: APPROVAL_ID,
          type: 'approval_request',
          body: { title: 'Approve a low-risk agent action' },
        }),
        notification({
          id: NotificationId.parse('01J0Z5BNEKTSV4RRFFQ69G5FAV'),
          type: 'assignment',
          body: { title: 'Review the launch checklist' },
        }),
      ],
      { tab: 'announcements' },
    );

    expect(screen.getByRole('tab', { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Unread/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Needs action/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Announcements/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Mentions & assignments/ })).toBeInTheDocument();
    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument();
    expect(screen.queryByText('Approve a low-risk agent action')).not.toBeInTheDocument();
    expect(screen.queryByText('Review the launch checklist')).not.toBeInTheDocument();
  });
});
