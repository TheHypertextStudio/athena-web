import { describe, expect, it } from 'vitest';

import {
  createGoogleWorkLocationTransport,
  type GoogleWorkLocationFetch,
} from '../../../src/services/work-location/google-transport';

function requireValue<T>(value: T | null | undefined, description: string): T {
  if (value == null) throw new Error(`Expected ${description}`);
  return value;
}

describe('Google primary-calendar work-location transport', () => {
  it('bootstraps unbounded masters/exceptions with the dedicated event type filter', async () => {
    const requests: string[] = [];
    const fetchJson: GoogleWorkLocationFetch = async (url) => {
      requests.push(url);
      return { items: [], nextSyncToken: 'next-cursor' } as never;
    };
    const transport = createGoogleWorkLocationTransport({
      fetchJson,
      getAccessToken: async () => ({ accessToken: 'token' }),
    });

    const result = await transport.pull({
      connectionId: 'connection-a',
      userId: 'user-a',
      externalAccountId: 'account-a',
      cursor: null,
    });

    expect(result.nextCursor).toBe('next-cursor');
    const url = new URL(requireValue(requests[0], 'bootstrap request'));
    expect(url.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(url.searchParams.get('eventTypes')).toBe('workingLocation');
    expect(url.searchParams.get('singleEvents')).toBe('false');
    expect(url.searchParams.get('showDeleted')).toBe('true');
    expect(url.searchParams.has('timeMin')).toBe(false);
    expect(url.searchParams.has('timeMax')).toBe(false);
  });

  it('uses individual event writes and a dedicated primary-calendar watch', async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    const fetchJson: GoogleWorkLocationFetch = async (url, _token, init) => {
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body });
      if (url.includes('/watch')) {
        return { resourceId: 'resource-1', expiration: '1786700000000' } as never;
      }
      return {
        ...(init?.body as object),
        id: 'event-1',
        eventType: 'workingLocation',
        updated: '2026-08-14T18:00:00.000Z',
        etag: 'etag-1',
      } as never;
    };
    const transport = createGoogleWorkLocationTransport({
      fetchJson,
      getAccessToken: async () => ({ accessToken: 'token' }),
    });
    await transport.upsert({
      connectionId: 'connection-a',
      userId: 'user-a',
      externalAccountId: 'account-a',
      externalEventId: 'event-1',
      externalEtag: null,
      body: { id: 'event-1', eventType: 'workingLocation' },
    });
    if (!transport.startWatch) throw new Error('Expected watch transport');
    await transport.startWatch({
      connectionId: 'connection-a',
      userId: 'user-a',
      externalAccountId: 'account-a',
      callbackUrl: 'https://api.example.com/webhooks/calendar/google',
      channelId: 'channel-1',
      token: 'secret-token',
    });

    expect(requests[0]).toMatchObject({ method: 'POST' });
    expect(requireValue(requests[0], 'event write request').url).toContain(
      '/calendars/primary/events',
    );
    expect(requests[1]).toMatchObject({
      method: 'POST',
      body: expect.objectContaining({
        id: 'channel-1',
        type: 'web_hook',
        address: 'https://api.example.com/webhooks/calendar/google',
        token: 'secret-token',
      }),
    });
    expect(requireValue(requests[1], 'watch request').url).toContain(
      '/calendars/primary/events/watch',
    );
  });

  it('finds one recurring instance inside the occurrence local day', async () => {
    const requests: string[] = [];
    const fetchJson: GoogleWorkLocationFetch = async (url) => {
      requests.push(url);
      return {
        items: [
          {
            id: 'instance-1',
            eventType: 'workingLocation',
            recurringEventId: 'master-1',
            originalStartTime: { date: '2026-03-08' },
          },
        ],
      } as never;
    };
    const transport = createGoogleWorkLocationTransport({
      fetchJson,
      getAccessToken: async () => ({ accessToken: 'token' }),
    });

    const instance = await transport.findInstance({
      connectionId: 'connection-a',
      userId: 'user-a',
      externalAccountId: 'account-a',
      masterExternalEventId: 'master-1',
      occurrenceDate: '2026-03-08',
      timezone: 'America/Los_Angeles',
    });

    expect(instance?.id).toBe('instance-1');
    const url = new URL(requireValue(requests[0], 'instance request'));
    expect(url.pathname).toContain('/events/master-1/instances');
    expect(url.searchParams.get('timeMin')).toBe('2026-03-08T08:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-03-09T07:00:00.000Z');
    expect(url.searchParams.get('showDeleted')).toBe('true');
  });
});
