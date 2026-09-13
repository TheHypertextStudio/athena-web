import { NotificationId } from '@docket/notifications/ids';
import type { NotificationOut } from '@docket/notifications/notification-contract';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInboxPage } from '../../../src/app/(app)/inbox/use-inbox-page';
import { makeQueryWrapper } from '../../support/query';

const notice: NotificationOut = {
  id: NotificationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  userId: 'inbox-user',
  organizationId: null,
  type: 'approval_request',
  body: { title: 'Review the update' },
  readAt: null,
  createdAt: '2026-09-12T12:00:00.000Z',
};
const requests: string[] = [];
let read = false;

beforeEach(() => {
  requests.length = 0;
  read = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(
        input instanceof Request ? input.url : input.toString(),
        'https://docket.example.test',
      ).pathname;
      requests.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/v1/hub/activity') return Response.json({ items: [] });
      if (!path.startsWith('/v1/me/notifications')) return Response.json({}, { status: 404 });
      if (init?.method === 'POST') {
        read = true;
        return Response.json(
          path.endsWith('/read-all')
            ? { updated: 1 }
            : { ...notice, readAt: '2026-09-12T13:00:00.000Z' },
        );
      }
      const unread = Number(!read);
      return Response.json(
        path.endsWith('/count')
          ? { unread, pendingApprovals: unread }
          : { items: [{ ...notice, readAt: read ? '2026-09-12T13:00:00.000Z' : null }] },
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('personal inbox client ownership', () => {
  it.each([
    ['onMarkRead', `${notice.id}/read`],
    ['onApprove', `${notice.id}/act`],
    ['onMarkAllRead', 'read-all'],
  ] as const)(
    'uses the personal family for %s and refreshes list and count',
    async (action, suffix) => {
      const { wrapper } = makeQueryWrapper();
      const { result } = renderHook(() => useInboxPage(), { wrapper });
      await waitFor(() => {
        expect(requests).toContain('GET /v1/me/notifications');
        expect(result.current.unreadCount).toBe(1);
      });
      await act(async () => result.current[action](notice.id));
      await waitFor(() => {
        expect(result.current.unreadCount).toBe(0);
      });
      expect(requests).toContain(`POST /v1/me/notifications/${suffix}`);
      expect(
        requests.filter((request) => request === 'GET /v1/me/notifications/count').length,
      ).toBeGreaterThan(1);
      expect(result.current.actionError).toBeNull();
      expect(requests.some((request) => request.includes('/v1/notifications'))).toBe(false);
    },
  );
});
