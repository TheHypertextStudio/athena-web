// @vitest-environment jsdom
import { makeNotificationIntentOutFixture } from '@docket/notifications/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationAnnouncementConsoleProps } from '../../src/app/(admin)/notifications/notification-console';

const state = vi.hoisted(() => ({ props: null as NotificationAnnouncementConsoleProps | null }));
// The console's visual controls have their own suite. Keep its API-owning parent and real client.
vi.mock('../../src/app/(admin)/notifications/notification-console', () => ({
  NotificationAnnouncementConsole: (props: NotificationAnnouncementConsoleProps) => {
    state.props = props;
    return null;
  },
}));

import NotificationsPage from '../../src/app/(admin)/notifications/page';
import { api } from '../../src/lib/api';
import { withQueryClient } from '../support/query-harness';

const intent = makeNotificationIntentOutFixture({ status: 'draft' });
const requests: { path: string; method: string; body: unknown }[] = [];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  requests.length = 0;
  state.props = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        'https://admin.example.test',
      );
      requests.push({ path: url.pathname, method: init?.method ?? 'GET', body: init?.body });
      return notificationResponse(url.pathname, init?.method ?? 'GET');
    }),
  );
});

function notificationResponse(path: string, method: string): Response {
  if (!path.startsWith('/admin/notifications')) return Response.json({}, { status: 404 });
  if (path === '/admin/notifications') {
    return method === 'POST'
      ? Response.json(intent, { status: 201 })
      : Response.json({ items: [intent] });
  }
  if (/\/(deliveries|recipients|inbound-events|audit)$/.test(path))
    return Response.json({ items: [] });
  if (path.endsWith('/estimate')) {
    return Response.json({
      recipientCount: 1,
      channelCounts: {
        web: { send: 1, delay: 0, suppress: 0 },
        email: { send: 0, delay: 0, suppress: 1 },
        sms: { send: 0, delay: 0, suppress: 0 },
        push: { send: 0, delay: 0, suppress: 0 },
      },
      suppressions: [],
      approvalRequired: false,
      approvalReasons: [],
    });
  }
  if (path.endsWith('/preview'))
    return Response.json({ subject: intent.subject, replyPolicy: 'none' });
  if (path.endsWith('/test')) {
    return Response.json({
      intentId: intent.id,
      status: 'sent',
      idempotent: false,
      recipients: [],
      deliveries: [],
      webNotifications: [],
    });
  }
  return Response.json(intent);
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

function consoleProps(): NotificationAnnouncementConsoleProps {
  if (!state.props) throw new Error('Expected the page to render its console');
  return state.props;
}

async function mountPage(): Promise<void> {
  await act(async () => {
    root.render(withQueryClient(<NotificationsPage />));
  });
  await vi.waitFor(() => {
    expect(consoleProps().pendingAction).toBeNull();
  });
}

describe('staff notification client ownership', () => {
  it.each([
    ['onTestSend', 'test'],
    ['onSendNow', 'send'],
    ['onCancel', 'cancel'],
  ] as const)(
    'uses the admin client for %s and refreshes delivery inspection',
    async (callback, suffix) => {
      await mountPage();
      const initialReads = requests.filter(({ path }) => path.endsWith('/deliveries')).length;
      await act(async () => {
        consoleProps()[callback]();
      });
      await vi.waitFor(() => {
        expect(requests).toContainEqual(
          expect.objectContaining({
            method: 'POST',
            path: `/admin/notifications/${intent.id}/${suffix}`,
          }),
        );
        expect(consoleProps().pendingAction).toBeNull();
      });
      expect(requests.filter(({ path }) => path.endsWith('/deliveries')).length).toBeGreaterThan(
        initialReads,
      );
      expect(requests.every(({ path }) => path.startsWith('/admin/'))).toBe(true);
      expect(consoleProps().error).toBeNull();
    },
  );

  it('creates a draft through the admin client', async () => {
    await mountPage();
    await act(async () => {
      consoleProps().onDraftChange('subject', 'Maintenance');
      consoleProps().onDraftChange('bodyText', 'A short interruption.');
      consoleProps().onDraftChange('audienceValue', 'user_1');
    });
    await act(async () => {
      consoleProps().onCreateDraft();
    });
    await vi.waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/admin/notifications' }),
      );
    });
    expect(requests.every(({ path }) => path.startsWith('/admin/'))).toBe(true);
  });

  it('inspects recipients with the typed admin client', async () => {
    const response = await api.admin.notifications[':id'].recipients.$get({
      param: { id: intent.id },
    });
    expect(response.status).toBe(200);
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: 'GET',
        path: `/admin/notifications/${intent.id}/recipients`,
      }),
    );
  });
});
