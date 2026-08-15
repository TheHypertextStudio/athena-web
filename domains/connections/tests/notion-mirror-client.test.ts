/**
 * `NotionMirrorClient` — the calls Docket really makes to Notion, and how their failures surface.
 *
 * @remarks
 * The client is the only place the connection domain touches a third party, so its failure
 * translation is load-bearing: everything above it branches on `ProviderError.kind` to decide
 * whether to re-authorize a connection, back off, or surface a hard error. Collapsing an expired
 * token into a generic failure means a user is shown "something went wrong" forever instead of a
 * reconnect prompt.
 *
 * The constructor takes a `fetch` override for exactly this, so these drive the real SDK against
 * a scripted transport. What is asserted is the request Docket sends and the outcome it derives —
 * not the SDK's own wire handling.
 */
import { describe, expect, it } from 'vitest';

import { NotionMirrorClient } from '../src/notion/adapters/notion-sdk-client';
import { ProviderError } from '../src/provider-error';

/** One captured outbound request. */
interface Captured {
  url: string;
  body: Record<string, unknown>;
}

/**
 * A `fetch` that replies with scripted payloads in order and records what was asked.
 *
 * @param replies - JSON bodies to return, one per call; a number returns that HTTP status instead.
 * @returns The capture buffer and the fetch override.
 */
function scripted(replies: readonly (Record<string, unknown> | number)[]): {
  calls: Captured[];
  fetchImpl: typeof fetch;
} {
  const calls: Captured[] = [];
  let index = 0;
  const fetchImpl = ((url: string, init?: { body?: string }) => {
    calls.push({
      url,
      body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>,
    });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (typeof reply === 'number') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'error',
            status: reply,
            code: codeFor(reply),
            message: `scripted ${reply}`,
          }),
          {
            status: reply,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** The Notion error code the SDK expects alongside each status these tests use. */
function codeFor(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'restricted_resource';
  if (status === 429) return 'rate_limited';
  return 'internal_server_error';
}

/** A minimal full page object the SDK will accept. */
function page(over: Record<string, unknown> = {}) {
  return {
    object: 'page',
    id: 'page-1',
    created_time: '2026-08-01T00:00:00.000Z',
    last_edited_time: '2026-08-02T00:00:00.000Z',
    archived: false,
    in_trash: false,
    properties: {},
    parent: { type: 'page_id', page_id: 'parent-1' },
    last_edited_by: { object: 'user', id: 'user-1' },
    created_by: { object: 'user', id: 'user-1' },
    url: 'https://notion.so/page-1',
    ...over,
  };
}

const client = (replies: readonly (Record<string, unknown> | number)[]) => {
  const { calls, fetchImpl } = scripted(replies);
  return { calls, notion: new NotionMirrorClient('token', fetchImpl) };
};

describe('how provider failures are classified', () => {
  // Each kind routes to a different recovery: `auth` prompts a reconnect, `rate_limit` backs off,
  // `provider` and `network` surface. Flattening them strands a user on the wrong one.
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'provider'],
  ])('maps HTTP %d to a %s error', async (status, kind) => {
    const { notion } = client([status]);
    await expect(notion.botId()).rejects.toMatchObject({ kind, provider: 'notion' });
  });

  it('treats a transport failure as a network error rather than a provider one', async () => {
    // Nothing was refused — the request never landed — so retrying is reasonable.
    const fetchImpl = (() =>
      Promise.reject(new Error('socket hang up'))) as unknown as typeof fetch;
    await expect(new NotionMirrorClient('token', fetchImpl).botId()).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('names the operation that failed, so a log says which call broke', async () => {
    const { notion } = client([500]);
    await expect(notion.botId()).rejects.toThrow(/identity lookup/);
  });
});

describe('identity and page lookup', () => {
  it('resolves the bot id the echo guard compares against', async () => {
    const { notion } = client([{ object: 'user', id: 'bot-9', type: 'bot' }]);
    expect(await notion.botId()).toBe('bot-9');
  });

  it('describes a page Notion returned in full', async () => {
    const { notion } = client([page({ id: 'p-7' })]);
    expect(await notion.describePage('p-7')).toMatchObject({ id: 'p-7' });
  });

  it('falls back to an Untitled stand-in when Notion returns only a partial page', async () => {
    // A partial object has no title to read; inventing one would be worse than saying Untitled.
    const { notion } = client([{ object: 'page', id: 'p-8' }]);
    expect(await notion.describePage('p-8')).toEqual({ id: 'p-8', title: 'Untitled' });
  });
});

describe('listing workspace people', () => {
  const person = (over: Record<string, unknown> = {}) => ({
    object: 'user',
    id: 'u-1',
    type: 'person',
    name: 'Ada',
    avatar_url: null,
    person: { email: 'ada@example.com' },
    ...over,
  });

  it('returns only people, never integration bots', async () => {
    // A bot in the people picker is an account nobody can assign work to.
    const { notion } = client([
      {
        object: 'list',
        results: [person(), { object: 'user', id: 'b-1', type: 'bot', bot: {} }],
        next_cursor: null,
        has_more: false,
      },
    ]);
    const people = await notion.listWorkspaceUsers();
    expect(people).toHaveLength(1);
    expect(people[0]?.externalId).toBe('u-1');
  });

  it('names an unnamed person rather than rendering a blank row', async () => {
    const { notion } = client([
      { object: 'list', results: [person({ name: null })], next_cursor: null, has_more: false },
    ]);
    expect((await notion.listWorkspaceUsers())[0]?.name).toBe('Unnamed');
  });

  it('omits an absent email and avatar instead of carrying nulls', async () => {
    const { notion } = client([
      {
        object: 'list',
        results: [person({ person: {}, avatar_url: null })],
        next_cursor: null,
        has_more: false,
      },
    ]);
    const first = (await notion.listWorkspaceUsers())[0];
    expect(first).not.toHaveProperty('email');
    expect(first).not.toHaveProperty('avatarUrl');
  });

  it('carries an avatar through when Notion has one', async () => {
    const { notion } = client([
      {
        object: 'list',
        results: [person({ avatar_url: 'https://cdn/a.png' })],
        next_cursor: null,
        has_more: false,
      },
    ]);
    expect((await notion.listWorkspaceUsers())[0]?.avatarUrl).toBe('https://cdn/a.png');
  });
});

describe('provisioning a database', () => {
  const spec = {
    title: 'Tasks',
    parentPageId: 'parent-1',
    columns: [{ field: 'title', title: 'Name', kind: 'title' as const }],
  };

  it('creates the database under the chosen page and reports its data source', async () => {
    const { calls, notion } = client([
      {
        object: 'database',
        id: 'db-1',
        url: 'https://notion.so/db-1',
        data_sources: [{ id: 'ds-1', name: 'Tasks' }],
      },
      { object: 'data_source', id: 'ds-1', properties: { Name: { id: 'prop-1', type: 'title' } } },
    ]);

    const result = await notion.provisionDatabase(spec);

    expect(result).toMatchObject({ externalDatabaseId: 'db-1', externalDataSourceId: 'ds-1' });
    expect(result.url).toBe('https://notion.so/db-1');
    expect(calls[0]?.body).toMatchObject({ parent: { type: 'page_id', page_id: 'parent-1' } });
  });

  it('refuses a database Notion created without a data source to write into', async () => {
    // The database exists but nothing could be mirrored to it; reporting success would strand the
    // connection in a state where every later write fails for an unexplained reason.
    const { notion } = client([{ object: 'database', id: 'db-1', data_sources: [] }]);
    await expect(notion.provisionDatabase(spec)).rejects.toBeInstanceOf(ProviderError);
  });

  it('omits the url when Notion did not return one', async () => {
    const { notion } = client([
      { object: 'database', id: 'db-1', data_sources: [{ id: 'ds-1' }] },
      { object: 'data_source', id: 'ds-1', properties: {} },
    ]);
    expect(await notion.provisionDatabase(spec)).not.toHaveProperty('url');
  });

  it('reports the failing title when creation is refused', async () => {
    const { notion } = client([401]);
    await expect(notion.provisionDatabase(spec)).rejects.toThrow(/Tasks/);
  });
});

describe('updating a schema', () => {
  const spec = {
    title: 'Tasks',
    parentPageId: 'parent-1',
    columns: [{ field: 'title', title: 'Name', kind: 'title' as const }],
  };

  it('sends the data source id alongside the new schema', async () => {
    const { calls, notion } = client([
      { object: 'data_source', id: 'ds-1', properties: { Name: { id: 'prop-1', type: 'title' } } },
    ]);

    const ids = await notion.updateDatabaseSchema('ds-1', spec);

    expect(calls[0]?.body).toMatchObject({ title: [{ text: { content: 'Tasks' } }] });
    expect(ids).toMatchObject({ title: 'prop-1' });
  });

  it('classifies a refused schema update rather than throwing raw SDK shapes', async () => {
    const { notion } = client([429]);
    await expect(notion.updateDatabaseSchema('ds-1', spec)).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });
});

describe('writing a row', () => {
  it('creates a page under the data source and returns its anchor', async () => {
    const { calls, notion } = client([page({ id: 'p-1' })]);

    const result = await notion.writeRow({
      kind: 'create',
      dataSourceId: 'ds-1',
      properties: {},
    });

    expect(result).toEqual({
      externalPageId: 'p-1',
      externalUpdatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(calls[0]?.body).toMatchObject({
      parent: { type: 'data_source_id', data_source_id: 'ds-1' },
    });
  });

  it('soft-deletes rather than destroying, because Notion deletes are recoverable', async () => {
    const { calls, notion } = client([page()]);
    await notion.writeRow({ kind: 'delete', dataSourceId: 'ds-1', externalPageId: 'p-1' });
    expect(calls[0]?.body).toMatchObject({ in_trash: true });
  });

  it('does nothing for a delete that names no page', async () => {
    const { calls, notion } = client([page()]);
    expect(await notion.writeRow({ kind: 'delete', dataSourceId: 'ds-1' })).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('refuses an update with no page anchor instead of creating a duplicate', async () => {
    const { notion } = client([page()]);
    await expect(
      notion.writeRow({ kind: 'update', dataSourceId: 'ds-1', properties: {} }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('refuses a write Notion accepted but returned no full page for', async () => {
    // Without an anchor the row could never be reconciled again, so a silent success would
    // orphan it.
    const { notion } = client([{ object: 'page', id: 'p-1' }]);
    await expect(
      notion.writeRow({ kind: 'create', dataSourceId: 'ds-1', properties: {} }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('classifies a refused write by its provider cause', async () => {
    const { notion } = client([403]);
    await expect(
      notion.writeRow({ kind: 'create', dataSourceId: 'ds-1', properties: {} }),
    ).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('querying changes', () => {
  it('reads live and trashed pages, letting the live copy win a race', async () => {
    // A page can move between partitions mid-query. Preferring the trashed copy would delete a
    // row somebody had just restored.
    const { notion } = client([
      { object: 'list', results: [page({ id: 'p-1' })], next_cursor: null, has_more: false },
      { object: 'list', results: [page({ id: 'p-1' })], next_cursor: null, has_more: false },
    ]);

    const changes = await notion.queryChanges('ds-1');

    expect(changes).toHaveLength(1);
    expect(changes[0]?.archived).toBe(false);
  });

  it('sends the incremental filter only when a watermark is supplied', async () => {
    const withSince = client([{ object: 'list', results: [], next_cursor: null, has_more: false }]);
    await withSince.notion.queryChanges('ds-1', '2026-08-01T00:00:00.000Z');
    expect(withSince.calls[0]?.body).toMatchObject({
      filter: { last_edited_time: { on_or_after: '2026-08-01T00:00:00.000Z' } },
    });

    const withoutSince = client([
      { object: 'list', results: [], next_cursor: null, has_more: false },
    ]);
    await withoutSince.notion.queryChanges('ds-1');
    expect(withoutSince.calls[0]?.body).not.toHaveProperty('filter');
  });

  it('classifies a refused query', async () => {
    const { notion } = client([500]);
    await expect(notion.queryChanges('ds-1')).rejects.toMatchObject({ kind: 'provider' });
  });
});
