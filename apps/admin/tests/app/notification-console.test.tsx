// @vitest-environment jsdom

import { NotificationIntentId } from '@docket/notifications/ids';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { notificationDraftToCreateInput } from '../../src/app/(admin)/notifications/notification-console-model';
import {
  NotificationAnnouncementConsole,
  type NotificationAnnouncementConsoleProps,
} from '../../src/app/(admin)/notifications/notification-console';
import type { AdminNotificationIntent } from '../../src/lib/types';
import { withQueryClient } from '../support/query-harness';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const intent: AdminNotificationIntent = {
  id: NotificationIntentId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
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

/** Every handler the console can call, so a test can assert which one fired. */
function handlers() {
  return {
    onDraftChange: vi.fn(),
    onCreateDraft: vi.fn(),
    onRefreshReview: vi.fn(),
    onTestSend: vi.fn(),
    onApprove: vi.fn(),
    onSendNow: vi.fn(),
    onCancel: vi.fn(),
    onSelectIntent: vi.fn(),
  };
}

/** A fully-populated console, overridable per test. */
function props(
  overrides: Partial<NotificationAnnouncementConsoleProps> = {},
): NotificationAnnouncementConsoleProps {
  return {
    intents: [intent],
    selectedIntent: intent,
    estimate: {
      recipientCount: 1284,
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
      web: { title: 'Scheduled maintenance tonight', body: 'Briefly unavailable.' },
      email: { subject: 'Scheduled maintenance tonight', text: 'Briefly unavailable.', html: '' },
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
    statusMessage: null,
    ...handlers(),
    ...overrides,
  };
}

describe('NotificationAnnouncementConsole', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  /** Mount the console with the given props. */
  async function render(overrides: Partial<NotificationAnnouncementConsoleProps> = {}) {
    const resolved = props(overrides);
    await act(async () => {
      root.render(withQueryClient(<NotificationAnnouncementConsole {...resolved} />));
    });
    return resolved;
  }

  /** A stage tab, by its accessible name. */
  function stageTab(name: string): HTMLElement {
    const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (candidate) => candidate.textContent.trim() === name,
    );
    if (!tab) throw new Error(`Expected a "${name}" stage tab.`);
    return tab as HTMLElement;
  }

  /** Move to a stage. */
  async function openStage(name: string): Promise<void> {
    await act(async () => {
      stageTab(name).click();
    });
  }

  /** Every button on screen, by accessible name. */
  function buttonNamed(name: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === name,
    );
  }

  it('opens on the compose stage with the announcement fields', async () => {
    await render();
    expect(container.querySelector('#announcement-subject')).not.toBeNull();
    expect(container.querySelector('#announcement-body')).not.toBeNull();
    expect(container.querySelector('#announcement-audience')).not.toBeNull();
  });

  it('keeps the later stages unavailable until an announcement exists', async () => {
    await render({ selectedIntent: null });
    for (const name of ['Review', 'Send', 'Monitor']) {
      expect(
        stageTab(name).getAttribute('aria-disabled') ?? stageTab(name).getAttribute('disabled'),
      ).not.toBeNull();
    }
  });

  it('shows one stage at a time', async () => {
    await render();
    expect(container.querySelector('#announcement-subject')).not.toBeNull();

    await openStage('Review');
    // The compose fields are gone: the workflow is staged, not a mosaic of every panel at once.
    expect(container.querySelector('#announcement-subject')).toBeNull();
    expect(container.textContent).toContain('1,284');
  });

  it('does not send on the first click', async () => {
    const resolved = await render();
    await openStage('Send');

    const send = buttonNamed('Send now');
    if (!send) throw new Error('Expected a send control on the send stage.');
    await act(async () => {
      send.click();
    });

    // The click opens the confirmation; nothing is delivered until it is confirmed. The dialog is
    // portalled to the document body, which is where Radix mounts an overlay.
    expect(resolved.onSendNow).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('sends once the operator confirms, and says how many people that reaches', async () => {
    const resolved = await render();
    await openStage('Send');

    await act(async () => {
      buttonNamed('Send now')?.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('Expected a confirmation dialog.');
    expect(dialog.textContent).toContain('1,284');

    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Send now',
    );
    if (!confirm) throw new Error('Expected a confirming control in the dialog.');
    await act(async () => {
      confirm.click();
    });

    expect(resolved.onSendNow).toHaveBeenCalledTimes(1);
  });

  it('lets a test send go without a confirmation, because it only reaches the operator', async () => {
    const resolved = await render();
    await openStage('Send');

    await act(async () => {
      buttonNamed('Send test to me')?.click();
    });

    expect(resolved.onTestSend).toHaveBeenCalledTimes(1);
  });

  it('selects an announcement from the list', async () => {
    const resolved = await render({ selectedIntent: null });
    const row = container.querySelector('[role="group"] button');
    if (!row) throw new Error('Expected the announcement list to render a selectable row.');

    await act(async () => {
      (row as HTMLButtonElement).click();
    });

    expect(resolved.onSelectIntent).toHaveBeenCalledWith(intent.id);
  });
});

describe('notificationDraftToCreateInput', () => {
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
