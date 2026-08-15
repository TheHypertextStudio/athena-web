/**
 * The Google work-location transport's recovery and lookup paths.
 *
 * @remarks
 * These are the arms that only run when something has gone sideways at the provider — an expired
 * sync token, an event that already exists, one that is already gone — plus the instance lookup a
 * recurring exception is matched through. Each exists to keep a sync converging rather than
 * wedging, so a mistake here does not throw: it silently stops syncing somebody's calendar, or
 * loops forever re-sending a write the provider already accepted.
 *
 * All of this drives the injected `fetchJson` seam, so what is asserted is the decision the
 * transport makes about a provider response, not HTTP mechanics.
 */
import { describe, expect, it } from 'vitest';

import {
  createGoogleWorkLocationTransport,
  GoogleWorkLocationApiError,
  type GoogleWorkLocationFetch,
} from '../../../src/services/work-location/google-transport';

const IDENTITY = {
  connectionId: 'conn-1',
  userId: 'user-1',
  externalAccountId: 'acct-1',
} as const;

/** Build a transport over a scripted sequence of replies, recording every URL it asked for. */
function scripted(replies: readonly unknown[]) {
  const urls: string[] = [];
  let call = 0;
  const fetchJson: GoogleWorkLocationFetch = async (url) => {
    urls.push(url);
    const reply = replies[call];
    call += 1;
    if (reply instanceof Error) throw reply;
    return reply as never;
  };
  return {
    urls,
    transport: createGoogleWorkLocationTransport({
      fetchJson,
      getAccessToken: async () => ({ accessToken: 'tk-1' }),
    }),
  };
}

describe('access token', () => {
  it('refuses to call Google at all when no access token comes back', async () => {
    // Calling with an empty bearer would return an opaque 401 from Google; failing here names it.
    const transport = createGoogleWorkLocationTransport({
      fetchJson: async () => ({}) as never,
      getAccessToken: async () => ({ accessToken: '' }),
    });
    await expect(transport.pull({ ...IDENTITY, cursor: null })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('pulling changes', () => {
  it('follows every page and keeps the sync token from the final one', async () => {
    const { urls, transport } = scripted([
      { items: [{ id: 'a' }], nextPageToken: 'p2' },
      { items: [{ id: 'b' }], nextSyncToken: 'cursor-final' },
    ]);

    const result = await transport.pull({ ...IDENTITY, cursor: null });

    expect(result.events.map((event) => event.id)).toEqual(['a', 'b']);
    expect(result.nextCursor).toBe('cursor-final');
    expect(urls[1]).toContain('pageToken=p2');
  });

  it('sends the stored cursor as a sync token on the first page only', async () => {
    const { urls, transport } = scripted([
      { items: [], nextPageToken: 'p2' },
      { items: [], nextSyncToken: 'cursor-2' },
    ]);

    await transport.pull({ ...IDENTITY, cursor: 'cursor-1' });

    expect(urls[0]).toContain('syncToken=cursor-1');
    // A page token and a sync token are mutually exclusive; sending both makes Google reject it.
    expect(urls[1]).not.toContain('syncToken=');
    expect(urls[1]).toContain('pageToken=p2');
  });

  it('keeps the existing cursor when a page reports no new sync token', async () => {
    const { transport } = scripted([{ items: [] }]);
    const result = await transport.pull({ ...IDENTITY, cursor: 'cursor-1' });
    expect(result.nextCursor).toBe('cursor-1');
  });

  it('tolerates a page that carries no items array', async () => {
    const { transport } = scripted([{ nextSyncToken: 'cursor-2' }]);
    const result = await transport.pull({ ...IDENTITY, cursor: null });
    expect(result.events).toEqual([]);
  });

  it('restarts from scratch when Google expires the sync token', async () => {
    // 410 means the incremental cursor is no longer usable. Re-pulling unbounded is the only way
    // back; propagating the error instead would stop the connection syncing permanently.
    const { urls, transport } = scripted([
      new GoogleWorkLocationApiError(410),
      { items: [{ id: 'a' }], nextSyncToken: 'cursor-fresh' },
    ]);

    const result = await transport.pull({ ...IDENTITY, cursor: 'stale-cursor' });

    expect(result.nextCursor).toBe('cursor-fresh');
    expect(urls[0]).toContain('syncToken=stale-cursor');
    expect(urls[1]).not.toContain('syncToken=');
  });

  it('does not retry a 410 that arrived on an already-unbounded pull', async () => {
    // There is nothing narrower to fall back to, so retrying would loop.
    const { transport } = scripted([new GoogleWorkLocationApiError(410)]);
    await expect(transport.pull({ ...IDENTITY, cursor: null })).rejects.toMatchObject({
      status: 410,
    });
  });

  it('propagates a failure that is not an expired cursor', async () => {
    const { transport } = scripted([new GoogleWorkLocationApiError(500)]);
    await expect(transport.pull({ ...IDENTITY, cursor: 'cursor-1' })).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('writing an event', () => {
  const upsert = {
    ...IDENTITY,
    externalEventId: 'evt-1',
    externalEtag: null,
    body: { summary: 'Home' },
  } as const;

  it('patches an event it already has an etag for, rather than creating a duplicate', async () => {
    const { urls, transport } = scripted([{ id: 'evt-1' }]);
    await transport.upsert(upsert);
    expect(urls).toHaveLength(1);

    const withEtag = scripted([{ id: 'evt-1' }]);
    await withEtag.transport.upsert({ ...upsert, externalEtag: 'etag-1' });
    expect(withEtag.urls[0]).toContain('/events/evt-1');
  });

  it('falls back to a patch when the create collides with an existing event', async () => {
    // 409 means Google already has this id — the write is still owed, so it becomes an update.
    const { urls, transport } = scripted([new GoogleWorkLocationApiError(409), { id: 'evt-1' }]);

    await transport.upsert(upsert);

    expect(urls[0]).toMatch(/\/events$/);
    expect(urls[1]).toContain('/events/evt-1');
  });

  it('propagates a create failure that is not a collision', async () => {
    const { transport } = scripted([new GoogleWorkLocationApiError(403)]);
    await expect(transport.upsert(upsert as never)).rejects.toMatchObject({ status: 403 });
  });
});

describe('deleting an event', () => {
  const remove = { ...IDENTITY, externalEventId: 'evt-1', externalEtag: null } as const;

  it.each([404, 410])('treats a %d as already deleted rather than an error', async (status) => {
    // The desired end state is "gone", and it is. Throwing would retry a delete forever.
    const { transport } = scripted([new GoogleWorkLocationApiError(status)]);
    await expect(transport.delete(remove as never)).resolves.toBeUndefined();
  });

  it('propagates a delete failure that leaves the event in place', async () => {
    const { transport } = scripted([new GoogleWorkLocationApiError(500)]);
    await expect(transport.delete(remove as never)).rejects.toMatchObject({ status: 500 });
  });
});

describe('finding the instance an exception belongs to', () => {
  const find = {
    ...IDENTITY,
    masterExternalEventId: 'master-1',
    occurrenceDate: '2026-08-12',
    timezone: 'America/Los_Angeles',
  } as const;

  it('matches an all-day occurrence by its original date', async () => {
    const { transport } = scripted([
      {
        items: [
          { id: 'x', originalStartTime: { date: '2026-08-11' } },
          { id: 'y', originalStartTime: { date: '2026-08-12' } },
        ],
      },
    ]);
    const found = await transport.findInstance(find);
    expect(found?.id).toBe('y');
  });

  it('matches a timed occurrence by its local date in the occurrence timezone', async () => {
    // 2026-08-13T05:00Z is still the 12th in Los Angeles; comparing instants would miss it.
    const { transport } = scripted([
      { items: [{ id: 'y', originalStartTime: { dateTime: '2026-08-13T05:00:00Z' } }] },
    ]);
    const found = await transport.findInstance(find);
    expect(found?.id).toBe('y');
  });

  it("prefers the occurrence's own timezone over the request's", async () => {
    const { transport } = scripted([
      {
        items: [
          {
            id: 'y',
            originalStartTime: { dateTime: '2026-08-12T23:00:00Z', timeZone: 'Europe/Berlin' },
          },
        ],
      },
    ]);
    // 23:00Z on the 12th is already the 13th in Berlin, so this must not match the 12th.
    expect(await transport.findInstance(find as never)).toBeNull();
  });

  it('skips an instance carrying no original start at all', async () => {
    const { transport } = scripted([{ items: [{ id: 'y' }] }]);
    expect(await transport.findInstance(find as never)).toBeNull();
  });

  it('returns nothing when the master reports no instances', async () => {
    const { transport } = scripted([{}]);
    expect(await transport.findInstance(find as never)).toBeNull();
  });
});

describe('starting a watch channel', () => {
  const watch = {
    ...IDENTITY,
    channelId: 'chan-1',
    callbackUrl: 'https://docket.test/webhook',
    token: 'verify-1',
  } as const;

  it('returns the channel resource and its expiry', async () => {
    const { transport } = scripted([{ resourceId: 'res-1', expiration: '1790000000000' }]);
    // `startWatch` is optional on the port — a provider that cannot push simply omits it.
    const startWatch = transport.startWatch?.bind(transport);
    if (!startWatch) throw new Error('the Google transport must support watch channels');
    const result = await startWatch(watch);
    expect(result.resourceId).toBe('res-1');
    expect(result.expiresAt).toEqual(new Date(1_790_000_000_000));
  });

  it.each([
    ['no resource id', { expiration: '1790000000000' }],
    ['no expiry', { resourceId: 'res-1' }],
  ])('refuses a watch response with %s, which could never be renewed', async (_label, reply) => {
    const { transport } = scripted([reply]);
    const startWatch = transport.startWatch?.bind(transport);
    if (!startWatch) throw new Error('the Google transport must support watch channels');
    await expect(startWatch(watch)).rejects.toMatchObject({ status: 502 });
  });
});
