import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../../src/connector-error';
import { GitHubProviderClient } from '../../src/github';
import { GmailProviderClient } from '../../src/gmail';
import { MockConnector } from '../../src/mock-connector';
import type { ProviderHttp } from '../../src/provider-http';

/** A record-only ProviderHttp double — captures GET paths and answers via a per-test router. */
class RecordingHttp {
  readonly paths: string[] = [];
  respond: (path: string) => unknown = () => ({});
  async getJson<T = unknown>(path: string): Promise<T> {
    this.paths.push(path);
    return this.respond(path) as T;
  }
  async postJson<T = unknown>(): Promise<T> {
    return {} as T;
  }
}

const WINDOW = {
  connectionId: 'conn_1',
  since: '2026-08-12T00:00:00.000Z',
  until: '2026-08-12T23:59:59.000Z',
};

describe('Gmail activity pull', () => {
  /** A `messages.get` metadata payload for one sent message. */
  function messageJson(
    id: string,
    over: { threadId?: string; subject?: string; inReplyTo?: string; to?: string } = {},
  ): unknown {
    const headers = [
      { name: 'From', value: 'me@example.com' },
      { name: 'To', value: over.to ?? 'ada@example.com, grace@example.com' },
      { name: 'Subject', value: over.subject ?? 'Re: Transit presentation' },
      ...(over.inReplyTo ? [{ name: 'In-Reply-To', value: over.inReplyTo }] : []),
    ];
    return {
      id,
      threadId: over.threadId ?? 'thread_transit',
      snippet: 'Asked for the slides.',
      internalDate: String(Date.parse('2026-08-12T14:00:00.000Z')),
      payload: { headers },
    };
  }

  function client(http: RecordingHttp): GmailProviderClient {
    return new GmailProviderClient(http as unknown as ProviderHttp);
  }

  it('asks only for messages the person sent, bounded by the window', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => (path.includes('/messages?') ? { messages: [] } : {});
    await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    const search = http.paths[0] ?? '';
    expect(decodeURIComponent(search)).toContain('from:me');
    expect(decodeURIComponent(search)).toContain('after:');
    expect(decodeURIComponent(search)).toContain('before:');
  });

  it('never reads the history feed, so the email-to-task cursor is untouched', async () => {
    // The failure this prevents: `history.list` is driven by a consumed `historyId` that the
    // email-to-task sweep owns and advances. If this pull walked it too, the two purposes would
    // alternately eat each other's delta and task suggestions would start disappearing.
    const http = new RecordingHttp();
    http.respond = (path) =>
      path.includes('/messages?') ? { messages: [{ id: 'm1' }] } : messageJson('m1');
    await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(http.paths.some((p) => p.includes('/history'))).toBe(false);
    expect(http.paths.some((p) => p.includes('historyId'))).toBe(false);
  });

  it('keys a draft on the message so re-polling a window changes nothing', async () => {
    const http = new RecordingHttp();
    http.respond = (path) =>
      path.includes('/messages?') ? { messages: [{ id: 'm1' }] } : messageJson('m1');

    const first = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });
    const second = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(first.drafts).toHaveLength(1);
    expect(first.drafts[0]!.dedupeKey).toBe(second.drafts[0]!.dedupeKey);
  });

  it('groups a day of replies on one thread under one subject', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.includes('/messages?')) return { messages: [{ id: 'm1' }, { id: 'm2' }] };
      return messageJson(path.includes('m1') ? 'm1' : 'm2', { threadId: 'thread_transit' });
    };
    const { drafts } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(drafts).toHaveLength(2);
    expect(new Set(drafts.map((d) => d.entity?.externalId))).toEqual(new Set(['thread_transit']));
    expect(new Set(drafts.map((d) => d.dedupeKey)).size).toBe(2);
  });

  it('distinguishes a reply from a new message via In-Reply-To', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.includes('/messages?')) return { messages: [{ id: 'm1' }, { id: 'm2' }] };
      return path.includes('m1')
        ? messageJson('m1', { inReplyTo: '<earlier@example.com>' })
        : messageJson('m2');
    };
    const { drafts } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    const replies = drafts.map((d) =>
      d.detail?.schema === 'gmail.message' ? d.detail.isReply : null,
    );
    expect(replies).toContain(true);
    expect(replies).toContain(false);
  });

  it('reports truncation rather than presenting a clipped day as complete', async () => {
    const http = new RecordingHttp();
    http.respond = (path) =>
      path.includes('/messages?')
        ? { messages: [{ id: 'm1' }, { id: 'm2' }] }
        : messageJson(path.includes('m1') ? 'm1' : 'm2');
    const { truncated } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 2 });

    expect(truncated).toBe(true);
  });

  it('skips a message it cannot place rather than recording an orphan', async () => {
    const http = new RecordingHttp();
    http.respond = (path) =>
      path.includes('/messages?')
        ? { messages: [{ id: 'm1' }] }
        : { id: 'm1', payload: { headers: [] } };
    const { drafts } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(drafts).toEqual([]);
  });
});

describe('GitHub activity pull', () => {
  function searchItem(over: Record<string, unknown> = {}): unknown {
    return {
      id: 2,
      node_id: 'PR_kwDO2',
      number: 2,
      title: 'Make OSM street import produce a real network',
      html_url: 'https://github.com/docket/mock/pull/2',
      created_at: '2026-08-12T09:00:00.000Z',
      closed_at: null,
      draft: false,
      pull_request: { merged_at: null },
      ...over,
    };
  }

  function client(http: RecordingHttp): GitHubProviderClient {
    return new GitHubProviderClient(http as unknown as ProviderHttp);
  }

  /** `login: null` answers `/user` with no identity at all. */
  function route(items: unknown[], login: string | null = 'willie') {
    return (path: string): unknown => {
      if (path === '/user') return login === null ? {} : { login };
      return { total_count: items.length, items };
    };
  }

  it('scopes the search to the connected person', async () => {
    const http = new RecordingHttp();
    http.respond = route([searchItem()]);
    await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    const search = http.paths.find((p) => p.startsWith('/search/issues')) ?? '';
    expect(decodeURIComponent(search)).toContain('author:willie');
    expect(decodeURIComponent(search)).toContain('type:pr');
  });

  it('refuses to pull rather than attribute other people’s work', async () => {
    // Falling back to "everything visible" when the login is unknown would record strangers' pull
    // requests as this person's day.
    const http = new RecordingHttp();
    http.respond = route([searchItem()], null);

    await expect(client(http).pullActivity({ ...WINDOW, maxDrafts: 50 })).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });

  it('records opening and merging as two distinct things that happened', async () => {
    const http = new RecordingHttp();
    http.respond = route([searchItem({ pull_request: { merged_at: '2026-08-12T17:00:00.000Z' } })]);
    const { drafts } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(drafts.map((d) => d.kind)).toEqual(['created', 'completed']);
    expect(new Set(drafts.map((d) => d.dedupeKey)).size).toBe(2);
    expect(drafts.every((d) => d.entity?.kind === 'work_item')).toBe(true);
  });

  it('ignores verbs that fall outside the window the search matched', async () => {
    // `updated:` is coarser than the events being recorded, so a pull request touched today may
    // have been opened weeks ago — that opening is not part of today.
    const http = new RecordingHttp();
    http.respond = route([
      searchItem({
        created_at: '2026-07-01T09:00:00.000Z',
        pull_request: { merged_at: '2026-08-12T17:00:00.000Z' },
      }),
    ]);
    const { drafts } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(drafts.map((d) => d.kind)).toEqual(['completed']);
  });

  it('treats a close without a merge as a completion too', async () => {
    const http = new RecordingHttp();
    http.respond = route([searchItem({ created_at: null, closed_at: '2026-08-12T18:00:00.000Z' })]);
    const { drafts } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(drafts.map((d) => d.kind)).toEqual(['completed']);
    expect(drafts[0]!.detail?.schema === 'github.pull_request' && drafts[0]!.detail.merged).toBe(
      false,
    );
  });

  it('reports truncation when the provider says more matched than it returned', async () => {
    const http = new RecordingHttp();
    http.respond = (path) =>
      path === '/user' ? { login: 'willie' } : { total_count: 9, items: [searchItem()] };
    const { truncated } = await client(http).pullActivity({ ...WINDOW, maxDrafts: 1 });

    expect(truncated).toBe(true);
  });
});

describe('MockConnector activity capability', () => {
  /** A mock whose sample activity lands inside {@link WINDOW}. */
  const inWindow = (provider: 'github' | 'gmail') =>
    new MockConnector({ provider, now: '2026-08-12T20:00:00.000Z' });

  it('is offered only for providers the catalog says Docket polls', () => {
    expect(inWindow('github').asActivitySource()).toBeDefined();
    expect(inWindow('gmail').asActivitySource()).toBeDefined();
    expect(new MockConnector({ provider: 'linear' }).asActivitySource()).toBeUndefined();
    expect(new MockConnector({ provider: 'gtasks' }).asActivitySource()).toBeUndefined();
  });

  it('stamps every draft with the provider’s canonical source badge', () => {
    expect(inWindow('gmail').asActivitySource()?.sourceSystem).toBe('gmail');
    expect(inWindow('github').asActivitySource()?.sourceSystem).toBe('github');
  });

  it('serves drafts inside the requested window, so the offline pipeline finds work', async () => {
    const source = inWindow('github').asActivitySource();
    if (!source) throw new Error('expected an activity source');
    const result = await source.pullActivity({ ...WINDOW, maxDrafts: 50 });

    expect(result.drafts.length).toBeGreaterThan(0);
    for (const draft of result.drafts) {
      expect(draft.occurredAt >= WINDOW.since).toBe(true);
      expect(draft.occurredAt < WINDOW.until).toBe(true);
      expect(draft.dedupeKey).not.toBe('');
    }
  });

  it('can represent a quiet day, so the empty state is exercisable offline', async () => {
    // The mock anchors to its own `now`, not to whatever window it is handed — otherwise every day
    // would look busy and there would be no way to build or verify the "nothing came in" surface.
    const source = new MockConnector({
      provider: 'gmail',
      now: '2026-01-01T00:00:00.000Z',
    }).asActivitySource();
    if (!source) throw new Error('expected an activity source');

    const { drafts } = await source.pullActivity({ ...WINDOW, maxDrafts: 50 });
    expect(drafts).toEqual([]);
  });

  it('reports a clipped page rather than a quietly shortened one', async () => {
    const source = inWindow('gmail').asActivitySource();
    if (!source) throw new Error('expected an activity source');

    const clipped = await source.pullActivity({ ...WINDOW, maxDrafts: 1 });
    expect(clipped.drafts).toHaveLength(1);
    expect(clipped.truncated).toBe(true);
  });
});
