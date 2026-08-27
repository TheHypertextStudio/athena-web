import { describe, expect, it, vi } from 'vitest';

import type { ConnectorProviderClient } from '../../src/provider-client';
import { ConnectorError } from '../../src/connector-error';
import { NOTION_API_VERSION } from '../../src/notion-mapping';
import { NotionProviderClient, isNotionProviderClient } from '../../src/notion';
import type { ProviderHttp } from '../../src/provider-http';
import {
  TASKS_TRACKER_DATA_SOURCE,
  TASKS_TRACKER_PROPERTIES,
  tasksTrackerPage,
} from './notion-fixtures';

/** One request the double recorded. */
interface RecordedCall {
  readonly method: 'get' | 'post' | 'patch';
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * A `ProviderHttp` double that records every call and answers from a per-test router.
 *
 * @remarks
 * Mirrors the Gmail suite's `RecordingHttp` so the Notion client is exercised through exactly the
 * seam the real connector uses — request building and response mapping are covered, only the
 * socket is replaced.
 */
class RecordingHttp {
  readonly calls: RecordedCall[] = [];
  get: (path: string) => unknown = () => ({});
  post: (path: string, body: unknown) => unknown = () => ({});
  patch: (path: string, body: unknown) => unknown = () => ({});

  async getJson<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
    this.calls.push({ method: 'get', path, ...(headers ? { headers } : {}) });
    return this.get(path) as T;
  }
  async postJson<T = unknown>(
    path: string,
    body: unknown,
    _auth?: 'bearer' | 'raw',
    headers?: Record<string, string>,
  ): Promise<T> {
    this.calls.push({ method: 'post', path, body, ...(headers ? { headers } : {}) });
    return this.post(path, body) as T;
  }
  async patchJson<T = unknown>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    this.calls.push({ method: 'patch', path, body, ...(headers ? { headers } : {}) });
    return this.patch(path, body) as T;
  }
}

function notion(http: RecordingHttp): NotionProviderClient {
  return new NotionProviderClient(http as unknown as ProviderHttp);
}

/** The `GET /data_sources/{id}` payload for the Tasks Tracker fixture. */
const trackerSchemaPayload = {
  object: 'data_source',
  id: TASKS_TRACKER_DATA_SOURCE,
  title: [{ type: 'text', plain_text: 'Tasks Tracker' }],
  properties: TASKS_TRACKER_PROPERTIES,
};

describe('NotionProviderClient.resolveAccount', () => {
  it('reports the bot owner and the workspace it is bound to', async () => {
    const http = new RecordingHttp();
    http.get = () => ({
      object: 'user',
      id: 'bot-1',
      name: 'Docket',
      type: 'bot',
      bot: {
        workspace_id: '886c7791-208f-8170-b9e8-0003da1e76cc',
        workspace_name: 'Las Vegans for Better Transit',
        owner: {
          type: 'user',
          user: {
            name: 'Willie Chalmers III',
            person: { email: 'willie@lasvegasfortransit.org' },
          },
        },
      },
    });

    expect(await notion(http).resolveAccount()).toEqual({
      label: 'Willie Chalmers III',
      externalWorkspaceId: '886c7791-208f-8170-b9e8-0003da1e76cc',
      externalWorkspaceName: 'Las Vegans for Better Transit',
    });
    expect(http.calls[0]).toMatchObject({
      method: 'get',
      path: '/users/me',
      headers: { 'Notion-Version': NOTION_API_VERSION },
    });
  });

  it('returns undefined rather than a fabricated account when the payload is not an object', async () => {
    const http = new RecordingHttp();
    http.get = () => null;
    expect(await notion(http).resolveAccount()).toBeUndefined();
  });

  it('falls back to the owner’s email when the bot owner user has no name', async () => {
    const http = new RecordingHttp();
    http.get = () => ({
      bot: {
        owner: { type: 'user', user: { person: { email: 'anon@lasvegasfortransit.org' } } },
      },
    });
    expect(await notion(http).resolveAccount()).toEqual({ label: 'anon@lasvegasfortransit.org' });
  });

  it('falls back to the bot’s own display name when neither an owner name nor email is present', async () => {
    const http = new RecordingHttp();
    http.get = () => ({ name: 'Docket Bot', bot: {} });
    expect(await notion(http).resolveAccount()).toEqual({ label: 'Docket Bot' });
  });

  it('omits every field the payload carries none of, rather than reporting blanks', async () => {
    const http = new RecordingHttp();
    http.get = () => ({});
    expect(await notion(http).resolveAccount()).toEqual({});
  });
});

describe('NotionProviderClient.listContainers', () => {
  it('searches for data sources, paginates, and skips trashed ones', async () => {
    const http = new RecordingHttp();
    let page = 0;
    http.post = (path, body) => {
      expect(path).toBe('/search');
      expect(body).toMatchObject({ filter: { property: 'object', value: 'data_source' } });
      page += 1;
      if (page === 1) {
        return {
          results: [
            { id: 'ds-1', title: [{ plain_text: 'Tasks Tracker' }] },
            { id: 'ds-trashed', title: [{ plain_text: 'Old' }], in_trash: true },
          ],
          has_more: true,
          next_cursor: 'cursor-2',
        };
      }
      return {
        results: [{ id: 'ds-2', title: [{ plain_text: 'My Tasks' }] }],
        has_more: false,
        next_cursor: null,
      };
    };

    expect(await notion(http).listContainers()).toEqual([
      { id: 'ds-1', title: 'Tasks Tracker' },
      { id: 'ds-2', title: 'My Tasks' },
    ]);
    // The second request resumed from the cursor the first one returned.
    expect(http.calls[1]?.body).toMatchObject({ start_cursor: 'cursor-2' });
  });

  it('labels a database with no title rather than emitting an empty picker row', async () => {
    const http = new RecordingHttp();
    http.post = () => ({ results: [{ id: 'ds-x' }], has_more: false });
    expect(await notion(http).listContainers()).toEqual([
      { id: 'ds-x', title: 'Untitled database' },
    ]);
  });

  it('skips a search result with no id rather than emitting a malformed container', async () => {
    const http = new RecordingHttp();
    http.post = () => ({
      results: [
        { title: [{ plain_text: 'No id' }] },
        { id: 'ds-ok', title: [{ plain_text: 'OK' }] },
      ],
      has_more: false,
    });
    expect(await notion(http).listContainers()).toEqual([{ id: 'ds-ok', title: 'OK' }]);
  });

  it('treats a page with no `results` array as empty rather than throwing', async () => {
    const http = new RecordingHttp();
    http.post = () => ({ has_more: false }); // no `results` key at all
    expect(await notion(http).listContainers()).toEqual([]);
  });

  it('stops paging — without a truncation warning — when Notion claims more but hands back no usable cursor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const http = new RecordingHttp();
      http.post = () => ({
        results: [{ id: 'ds-1', title: [{ plain_text: 'Only page' }] }],
        has_more: true,
        next_cursor: null, // has_more says yes, but there's nothing to resume from
      });
      expect(await notion(http).listContainers()).toEqual([{ id: 'ds-1', title: 'Only page' }]);
      // This is a "no usable cursor" stop, not a page-count truncation — no warning either way.
      expect(warn).not.toHaveBeenCalled();
      expect(http.calls).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('stops at the page-count safety bound and logs a truncation warning, never a silent partial pull', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const http = new RecordingHttp();
      let call = 0;
      // Every page reports has_more, so the loop only ever stops at MAX_IMPORT_PAGES.
      http.post = () => {
        call += 1;
        return {
          results: [{ id: `ds-${call}`, title: [{ plain_text: `DB ${call}` }] }],
          has_more: true,
          next_cursor: `cursor-${call}`,
        };
      };
      const refs = await notion(http).listContainers();
      expect(refs).toHaveLength(100);
      expect(warn).toHaveBeenCalledTimes(1);
      const [line] = warn.mock.calls[0] as [string];
      expect(line).toContain('import_truncated');
      expect(line).toContain('data_sources');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('NotionProviderClient.importWork', () => {
  it('imports a page body from Notion Markdown instead of flattening it into Description', async () => {
    const http = new RecordingHttp();
    http.get = (path) =>
      path === '/pages/page-body/markdown'
        ? {
            object: 'page_markdown',
            id: 'page-body',
            markdown: '## Decision\n\n- [ ] Ship the real content.',
            truncated: false,
            unknown_block_ids: [],
          }
        : trackerSchemaPayload;
    http.post = (path, body) => {
      if (!path.endsWith('/query')) return { results: [], has_more: false };
      if ((body as Record<string, unknown>)['is_archived'] === true) {
        return { results: [], has_more: false };
      }
      return {
        results: [
          tasksTrackerPage({
            id: 'page-body',
            description: 'This short property is no longer the page body.',
          }),
        ],
        has_more: false,
      };
    };

    const [item] = await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );

    expect(item?.body).toBe('## Decision\n\n- [ ] Ship the real content.');
    expect(item?.notionMappingProfile).toEqual({
      version: 1,
      dataSourceId: TASKS_TRACKER_DATA_SOURCE,
      fields: expect.arrayContaining([
        { field: 'title', property: 'Task name', confidence: 'structural' },
        { field: 'dueDate', property: 'Due date', confidence: 'high' },
      ]),
    });
    expect(http.calls).toContainEqual(
      expect.objectContaining({ method: 'get', path: '/pages/page-body/markdown' }),
    );
  });

  it('queries the selected data sources and maps every row', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = (path, body) => {
      if (!path.endsWith('/query')) return { results: [], has_more: false };
      if ((body as Record<string, unknown>)['is_archived'] === true) {
        return { results: [], has_more: false };
      }
      return {
        results: [
          tasksTrackerPage({ id: 'page-1', title: 'One', status: 'Done' }),
          tasksTrackerPage({ id: 'page-2', title: 'Two' }),
        ],
        has_more: false,
      };
    };

    const items = await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );

    expect(items.map((i) => [i.title, i.completed])).toEqual([
      ['One', true],
      ['Two', false],
    ]);
    expect(items[0]?.provenance.externalListId).toBe(TASKS_TRACKER_DATA_SOURCE);
    // The schema was fetched once, then reused for the second row. Each page body has its own
    // Markdown request, so count only schema reads here.
    expect(
      http.calls.filter((c) => c.method === 'get' && c.path.startsWith('/data_sources/')),
    ).toHaveLength(1);
  });

  it('deduplicates a page that appears in both the live and archived passes, live winning', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    // A router that ignores `is_archived` returns the same rows twice — the mid-pagination race.
    http.post = (path) =>
      path.endsWith('/query')
        ? {
            results: [tasksTrackerPage({ id: 'racy', title: 'Live', inTrash: false })],
            has_more: false,
          }
        : { results: [], has_more: false };

    const items = await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.removed).toBeUndefined();
  });

  it('asks for the archived partition with `is_archived`, never `in_trash`', async () => {
    // Sending `in_trash` here is rejected outright — `body failed validation: body.in_trash should
    // be not present` — which failed every sync of every Notion connection rather than merely
    // skipping the trashed partition. The spelling is endpoint-specific: `in_trash` is correct
    // when updating a *page* (asserted separately below), and wrong on a data-source query, so an
    // assertion on the request body is the only thing that keeps the two apart.
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = (path) =>
      path.endsWith('/query') ? { results: [], has_more: false } : { results: [], has_more: false };

    await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );

    const queries = http.calls.filter((call) => call.path.endsWith('/query'));
    expect(queries.length).toBeGreaterThan(0);
    expect(
      queries.some((call) => (call.body as Record<string, unknown>)['is_archived'] === true),
    ).toBe(true);
    expect(queries.every((call) => !('in_trash' in (call.body as Record<string, unknown>)))).toBe(
      true,
    );
  });

  it('pulls the archived partition too, so a Notion delete arrives as a tombstone', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = (path, body) => {
      if (!path.endsWith('/query')) return { results: [], has_more: false };
      const archived = (body as Record<string, unknown>)['is_archived'] === true;
      return {
        results: archived
          ? [tasksTrackerPage({ id: 'gone', title: 'Deleted in Notion', inTrash: true })]
          : [tasksTrackerPage({ id: 'live', title: 'Still here' })],
        has_more: false,
      };
    };

    const items = await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );
    expect(items.map((i) => [i.title, i.removed ?? false])).toEqual([
      ['Still here', false],
      ['Deleted in Notion', true],
    ]);
  });

  it('filters both partitions to last_edited_time when the caller supplies a cursor', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = (path) =>
      path.endsWith('/query') ? { results: [], has_more: false } : { results: [], has_more: false };

    await notion(http).importWork(
      {
        connectionId: 'c',
        provider: 'notion',
        listIds: [TASKS_TRACKER_DATA_SOURCE],
        since: '2026-08-01T00:00:00.000Z',
      },
      '2026-08-02T00:00:00.000Z',
    );

    const queries = http.calls.filter((c) => c.path.endsWith('/query'));
    expect(queries).toHaveLength(2); // live + archived
    for (const call of queries) {
      expect(call.body).toMatchObject({
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: { on_or_after: '2026-08-01T00:00:00.000Z' },
        },
      });
    }
  });

  it('omits the filter entirely when the caller supplies no cursor, re-reading everything', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = () => ({ results: [], has_more: false });

    await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );

    const queries = http.calls.filter((c) => c.path.endsWith('/query'));
    for (const call of queries) {
      expect((call.body as Record<string, unknown>)['filter']).toBeUndefined();
    }
  });

  it('falls back to every shared database when no list is selected', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = (path) =>
      path === '/search'
        ? {
            results: [{ id: TASKS_TRACKER_DATA_SOURCE, title: [{ plain_text: 'T' }] }],
            has_more: false,
          }
        : { results: [], has_more: false };

    await notion(http).importWork(
      { connectionId: 'c', provider: 'notion' },
      '2026-08-02T00:00:00.000Z',
    );
    expect(http.calls.some((c) => c.path === '/search')).toBe(true);
    expect(
      http.calls.some((c) => c.path === `/data_sources/${TASKS_TRACKER_DATA_SOURCE}/query`),
    ).toBe(true);
  });

  it('throws instead of importing blank tasks when a database returns no schema', async () => {
    const http = new RecordingHttp();
    http.get = () => ({ object: 'data_source', id: 'ds' });
    await expect(
      notion(http).importWork({ connectionId: 'c', provider: 'notion', listIds: ['ds'] }, 'now'),
    ).rejects.toBeInstanceOf(ConnectorError);
  });

  it('caches the schema per data source, so a second sync run on the same client reuses it', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = (path) =>
      path.endsWith('/query')
        ? { results: [tasksTrackerPage({ id: 'p1' })], has_more: false }
        : { results: [], has_more: false };

    const client = notion(http);
    await client.importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );
    await client.importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );
    // One schema read total — body reads remain per page and per sync.
    expect(
      http.calls.filter((c) => c.method === 'get' && c.path.startsWith('/data_sources/')),
    ).toHaveLength(1);
  });

  it('paginates a data source query across multiple pages, in both the live and archived partitions', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    let livePage = 0;
    let archivedPage = 0;
    http.post = (path, body) => {
      if (!path.endsWith('/query')) return { results: [], has_more: false };
      if ((body as Record<string, unknown>)['is_archived'] === true) {
        archivedPage += 1;
        return archivedPage === 1
          ? {
              results: [tasksTrackerPage({ id: 'a1', title: 'Archived one', inTrash: true })],
              has_more: true,
              next_cursor: 'archived-cursor',
            }
          : {
              results: [tasksTrackerPage({ id: 'a2', title: 'Archived two', inTrash: true })],
              has_more: false,
            };
      }
      livePage += 1;
      return livePage === 1
        ? {
            results: [tasksTrackerPage({ id: 'l1', title: 'Live one' })],
            has_more: true,
            next_cursor: 'live-cursor',
          }
        : { results: [tasksTrackerPage({ id: 'l2', title: 'Live two' })], has_more: false };
    };

    const items = await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );
    expect(items.map((i) => i.id)).toEqual(['l1', 'l2', 'a1', 'a2']);
    // Each second page resumed from the cursor its first page returned.
    const queryCalls = http.calls.filter((c) => c.path.endsWith('/query'));
    expect(queryCalls[1]?.body).toMatchObject({ start_cursor: 'live-cursor' });
    expect(queryCalls[3]?.body).toMatchObject({ start_cursor: 'archived-cursor' });
  });
});

describe('NotionProviderClient.pushTask — the write half', () => {
  it('writes the full Markdown body and refreshes the page anchor after a property update', async () => {
    const http = new RecordingHttp();
    http.get = (path) =>
      path === '/pages/page-1'
        ? { object: 'page', id: 'page-1', last_edited_time: '2026-08-03T10:00:02.000Z' }
        : trackerSchemaPayload;
    http.patch = (path) =>
      path === '/pages/page-1/markdown'
        ? { object: 'page_markdown', id: 'page-1', markdown: '# Full body' }
        : { object: 'page', id: 'page-1', last_edited_time: '2026-08-03T10:00:00.000Z' };

    const result = await notion(http).pushTask({
      kind: 'update',
      listId: TASKS_TRACKER_DATA_SOURCE,
      externalId: 'page-1',
      notes: '# Full body',
    });

    expect(http.calls).toContainEqual(
      expect.objectContaining({
        method: 'patch',
        path: '/pages/page-1/markdown',
        body: { type: 'replace_content', replace_content: { new_str: '# Full body' } },
      }),
    );
    expect(result).toEqual({
      externalId: 'page-1',
      externalUpdatedAt: '2026-08-03T10:00:02.000Z',
    });
  });

  it('PATCHes the page properties and returns the new sync anchor', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.patch = () => ({
      object: 'page',
      id: 'page-1',
      last_edited_time: '2026-08-03T10:00:00.000Z',
    });

    const result = await notion(http).pushTask({
      kind: 'update',
      listId: TASKS_TRACKER_DATA_SOURCE,
      externalId: 'page-1',
      title: 'Docket’s title',
      completed: true,
    });

    expect(result).toEqual({
      externalId: 'page-1',
      externalUpdatedAt: '2026-08-03T10:00:00.000Z',
    });
    const patch = http.calls.find((c) => c.method === 'patch');
    expect(patch?.path).toBe('/pages/page-1');
    expect(patch?.headers).toEqual({ 'Notion-Version': NOTION_API_VERSION });
    expect(patch?.body).toEqual({
      properties: {
        'Task name': { title: [{ type: 'text', text: { content: 'Docket’s title' } }] },
        Status: { status: { name: 'Done' } },
      },
    });
  });

  it('creates a page under the data source parent', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = () => ({ id: 'new-page', last_edited_time: '2026-08-03T10:00:00.000Z' });

    await notion(http).pushTask({
      kind: 'create',
      listId: TASKS_TRACKER_DATA_SOURCE,
      title: 'Brand new',
      completed: false,
    });

    const create = http.calls.find((c) => c.path === '/pages');
    expect(create?.body).toMatchObject({
      parent: { type: 'data_source_id', data_source_id: TASKS_TRACKER_DATA_SOURCE },
    });
  });

  it('deletes by moving the page to Notion’s trash — never a destructive hard delete', async () => {
    const http = new RecordingHttp();
    http.patch = () => ({});
    expect(
      await notion(http).pushTask({
        kind: 'delete',
        listId: TASKS_TRACKER_DATA_SOURCE,
        externalId: 'page-1',
      }),
    ).toBeUndefined();
    expect(http.calls[0]).toMatchObject({ path: '/pages/page-1', body: { in_trash: true } });
    // A delete needs no schema, so it never spends a request fetching one.
    expect(http.calls.filter((c) => c.method === 'get')).toHaveLength(0);
  });

  it('throws rather than reporting a successful write with no anchor to prove it', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.patch = () => ({ object: 'page', id: 'page-1' }); // no last_edited_time
    await expect(
      notion(http).pushTask({
        kind: 'update',
        listId: TASKS_TRACKER_DATA_SOURCE,
        externalId: 'page-1',
        title: 'x',
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe('NotionProviderClient.mirrorStatus', () => {
  it('reports the reachable database count (it always asks Notion first)', async () => {
    const http = new RecordingHttp();
    http.post = () => ({ results: [{ id: 'a' }, { id: 'b' }], has_more: false });
    expect(await notion(http).mirrorStatus({ connectionId: 'c', provider: 'notion' })).toEqual({
      connectionId: 'c',
      status: 'idle',
      itemCount: 2,
    });
  });
});

describe('NotionProviderClient.resolveExternalUrl', () => {
  it('derives the canonical notion.so URL from the external page id alone', async () => {
    const http = new RecordingHttp();
    await expect(
      notion(http).resolveExternalUrl({
        connectionId: 'c',
        provider: 'notion',
        resourceId: 'task-1',
        externalId: '386c7791-208f-80e6-a74e-da40db98177e',
      }),
    ).resolves.toBe('https://www.notion.so/386c7791208f80e6a74eda40db98177e');
    // Link resolution is pure — it never spends a request on it.
    expect(http.calls).toHaveLength(0);
  });
});

describe('isNotionProviderClient', () => {
  it('narrows a Notion client and rejects a structurally different one', () => {
    const client = notion(new RecordingHttp());
    expect(isNotionProviderClient(client)).toBe(true);

    const other: ConnectorProviderClient = {
      resolveAccount: async () => undefined,
      listContainers: async () => [],
      importWork: async () => [],
      mirrorStatus: async (input) => ({
        connectionId: input.connectionId,
        status: 'idle',
        itemCount: 0,
      }),
      resolveExternalUrl: async () => undefined,
    };
    expect(isNotionProviderClient(other)).toBe(false);
  });
});
