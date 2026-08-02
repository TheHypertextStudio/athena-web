import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../../src/connector-error';
import { NOTION_API_VERSION } from '../../src/notion-mapping';
import { NotionProviderClient } from '../../src/notion';
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
});

describe('NotionProviderClient.importWork', () => {
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
    // The schema was fetched once, then reused for the second row (and the archived pass).
    expect(http.calls.filter((c) => c.method === 'get')).toHaveLength(1);
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
});

describe('NotionProviderClient.pushTask — the write half', () => {
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
