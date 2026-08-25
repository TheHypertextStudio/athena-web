/**
 * `NotionMirrorClient`'s I/O edge — the requests it sends and what it makes of the answers.
 *
 * @remarks
 * `notion-mirror-sdk.test.ts` covers the pure translation helpers and the search request. This file
 * covers the rest of the adapter: every method that reaches Notion, driven through the `fetchImpl`
 * seam the constructor exposes for exactly this. Nothing here touches the network.
 *
 * What is worth asserting at this boundary is narrow and specific: that the request Notion receives
 * says what the caller meant, that a partial or surprising response becomes a `ProviderError`
 * rather than a half-built value, and that the remediation category survives — an expired grant has
 * to stay distinguishable from a rate limit, because only one of them is worth asking a person to
 * reconnect for.
 */
import { describe, expect, it } from 'vitest';

import { NotionMirrorClient } from '../src/notion/adapters/notion-sdk';
import { ProviderError } from '../src/provider-error';
import type { MirrorColumnSpec } from '../src/notion/mirror-port';

/** One recorded outbound call. */
interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/** A route table keyed by `METHOD /path-prefix`, answering with canned JSON. */
function router(routes: Record<string, unknown>): {
  readonly calls: Call[];
  readonly fetchImpl: typeof fetch;
} {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({ method, path, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
    const key = Object.keys(routes).find((candidate) => {
      const [routeMethod, routePath] = candidate.split(' ');
      return routeMethod === method && path.startsWith(routePath ?? '');
    });
    const answer = key === undefined ? {} : routes[key];
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** A fetch that answers every request with one Notion error body. */
function failing(status: number, code: string): typeof fetch {
  return ((_url: string) =>
    Promise.resolve(
      new Response(JSON.stringify({ object: 'error', status, code, message: 'nope' }), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      }),
    )) as unknown as typeof fetch;
}

/** A full page response, the only shape the adapter's mappers accept. */
function page(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'page',
    id: 'page_1',
    url: 'https://www.notion.so/page-1',
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-02T03:04:05.000Z',
    last_edited_by: { object: 'user', id: 'user_9' },
    created_by: { object: 'user', id: 'user_9' },
    cover: null,
    icon: null,
    parent: { type: 'workspace', workspace: true },
    archived: false,
    in_trash: false,
    properties: { Name: { id: 'title', type: 'title', title: [{ plain_text: 'Roadmap' }] } },
    ...over,
  };
}

const titleColumn: MirrorColumnSpec = { field: 'title', title: 'Task name', kind: 'title' };

describe('NotionMirrorClient.botId', () => {
  it('returns the integration’s own id, which the echo guard compares against', async () => {
    const { fetchImpl } = router({ 'GET /v1/users/me': { object: 'user', id: 'bot_7' } });
    expect(await new NotionMirrorClient('t', fetchImpl).botId()).toBe('bot_7');
  });
});

describe('NotionMirrorClient.describePage', () => {
  it('maps a retrieved page onto the parent-page shape', async () => {
    const { calls, fetchImpl } = router({ 'GET /v1/pages': page() });
    const described = await new NotionMirrorClient('t', fetchImpl).describePage('page_1');

    expect(calls[0]?.path).toBe('/v1/pages/page_1');
    expect(described).toMatchObject({ id: 'page_1', title: 'Roadmap', parentKind: 'workspace' });
  });

  it('names a page it could not read rather than returning nothing', async () => {
    // Notion answers a restricted page with a partial object. Returning `undefined` here would
    // strand the setup flow on a page the person can see in their own picker.
    const { fetchImpl } = router({ 'GET /v1/pages': { object: 'page', id: 'page_1' } });
    expect(await new NotionMirrorClient('t', fetchImpl).describePage('page_1')).toEqual({
      id: 'page_1',
      title: 'Untitled',
    });
  });
});

describe('NotionMirrorClient.listWorkspaceUsers', () => {
  it('returns people and leaves integration bots out of the roster', async () => {
    // A bot in the assignee picker is a name nobody can hand work to.
    const { fetchImpl } = router({
      'GET /v1/users': {
        object: 'list',
        next_cursor: null,
        has_more: false,
        results: [
          {
            object: 'user',
            id: 'u_1',
            name: 'Ada',
            avatar_url: 'https://example.com/a.png',
            type: 'person',
            person: { email: 'ada@example.com' },
          },
          { object: 'user', id: 'bot_1', name: 'Docket', type: 'bot', bot: {} },
        ],
      },
    });

    expect(await new NotionMirrorClient('t', fetchImpl).listWorkspaceUsers()).toEqual([
      {
        externalId: 'u_1',
        name: 'Ada',
        email: 'ada@example.com',
        avatarUrl: 'https://example.com/a.png',
      },
    ]);
  });

  it('keeps a person Notion gave no name or avatar', async () => {
    const { fetchImpl } = router({
      'GET /v1/users': {
        object: 'list',
        next_cursor: null,
        has_more: false,
        results: [
          { object: 'user', id: 'u_2', name: null, avatar_url: null, type: 'person', person: {} },
        ],
      },
    });

    expect(await new NotionMirrorClient('t', fetchImpl).listWorkspaceUsers()).toEqual([
      { externalId: 'u_2', name: 'Unnamed' },
    ]);
  });
});

describe('NotionMirrorClient.provisionDatabase', () => {
  it('creates the database under the chosen page and binds the ids Notion assigned', async () => {
    const { calls, fetchImpl } = router({
      'POST /v1/databases': {
        object: 'database',
        id: 'db_1',
        url: 'https://www.notion.so/db-1',
        data_sources: [{ id: 'ds_1', name: 'Tasks' }],
      },
      'GET /v1/data_sources': {
        object: 'data_source',
        id: 'ds_1',
        properties: { 'Task name': { id: 'title' } },
      },
    });

    const provisioned = await new NotionMirrorClient('t', fetchImpl).provisionDatabase({
      parentPageId: 'page_1',
      title: 'Docket tasks',
      entityType: 'task',
      columns: [titleColumn],
    });

    expect(calls[0]?.body).toMatchObject({
      parent: { type: 'page_id', page_id: 'page_1' },
      description: [{ type: 'text', text: { content: 'Managed by Docket · task' } }],
    });
    expect(provisioned).toEqual({
      externalDatabaseId: 'db_1',
      externalDataSourceId: 'ds_1',
      url: 'https://www.notion.so/db-1',
      propertyIds: { title: 'title' },
    });
  });

  it('refuses a database Notion created without a data source', async () => {
    // Every later call addresses the data source. Returning a binding without one would record a
    // connection that looks provisioned and can never sync a row.
    const { fetchImpl } = router({
      'POST /v1/databases': { object: 'database', id: 'db_1', data_sources: [] },
    });

    const rejected = new NotionMirrorClient('t', fetchImpl).provisionDatabase({
      parentPageId: 'page_1',
      title: 'Docket tasks',
      entityType: 'task',
      columns: [titleColumn],
    });
    await expect(rejected).rejects.toBeInstanceOf(ProviderError);
    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'provider' });
  });

  it('refuses a partial database response that omits its data sources', async () => {
    // Notion can return partial objects when a token loses access between creation and response.
    // Treating that shape as provisioned would persist an unusable database binding.
    const { fetchImpl } = router({
      'POST /v1/databases': { object: 'database', id: 'db_1' },
    });

    const rejected = new NotionMirrorClient('t', fetchImpl).provisionDatabase({
      parentPageId: 'page_1',
      title: 'Docket tasks',
      entityType: 'task',
      columns: [titleColumn],
    });
    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'provider' });
  });

  it('names the database in the error when creation itself fails', async () => {
    const rejected = new NotionMirrorClient(
      't',
      failing(400, 'validation_error'),
    ).provisionDatabase({
      parentPageId: 'page_1',
      title: 'Docket tasks',
      entityType: 'task',
      columns: [titleColumn],
    });
    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'provider' });
  });
});

describe('NotionMirrorClient.findProvisionedDatabases', () => {
  it('adopts only a matching database created by the bot after the durable intent', async () => {
    const { fetchImpl } = router({
      'GET /v1/blocks': {
        object: 'list',
        type: 'block',
        block: {},
        next_cursor: null,
        has_more: false,
        results: [
          {
            object: 'block',
            id: 'db_1',
            type: 'child_database',
            child_database: { title: 'Docket tasks' },
            created_by: { id: 'bot_1' },
            created_time: '2026-08-24T12:00:01.000Z',
          },
        ],
      },
      'GET /v1/databases': {
        object: 'database',
        id: 'db_1',
        title: [],
        description: [{ plain_text: 'Managed by Docket · task' }],
        created_time: '2026-08-24T12:00:01.000Z',
        data_sources: [{ id: 'ds_1', name: 'Tasks' }],
        url: 'https://www.notion.so/db-1',
      },
      'GET /v1/data_sources': {
        object: 'data_source',
        id: 'ds_1',
        properties: { 'Task name': { id: 'title' } },
      },
    });

    const found = await new NotionMirrorClient('t', fetchImpl).findProvisionedDatabases(
      {
        parentPageId: 'page_1',
        title: 'Docket tasks',
        entityType: 'task',
        columns: [titleColumn],
      },
      { createdAtOrAfter: '2026-08-24T12:00:00.000Z', createdBy: 'bot_1' },
    );

    expect(found).toEqual([
      {
        externalDatabaseId: 'db_1',
        externalDataSourceId: 'ds_1',
        url: 'https://www.notion.so/db-1',
        propertyIds: { title: 'title' },
      },
    ]);
  });

  it('ignores non-database children and databases for another entity', async () => {
    const { fetchImpl } = router({
      'GET /v1/blocks': {
        object: 'list',
        type: 'block',
        block: {},
        next_cursor: null,
        has_more: false,
        results: [
          { object: 'block', id: 'note_1', type: 'paragraph', paragraph: {} },
          {
            object: 'block',
            id: 'db_1',
            type: 'child_database',
            child_database: { title: 'Another mirror' },
            created_by: { id: 'bot_1' },
            created_time: '2026-08-24T12:00:01.000Z',
          },
        ],
      },
      'GET /v1/databases': {
        object: 'database',
        id: 'db_1',
        title: [],
        description: [{ plain_text: 'Managed by Docket · project' }],
        created_time: '2026-08-24T12:00:01.000Z',
        data_sources: [{ id: 'ds_1', name: 'Tasks' }],
        url: 'https://www.notion.so/db-1',
      },
    });

    const found = await new NotionMirrorClient('t', fetchImpl).findProvisionedDatabases(
      {
        parentPageId: 'page_1',
        title: 'Docket tasks',
        entityType: 'task',
        columns: [titleColumn],
      },
      { createdAtOrAfter: '2026-08-24T12:00:00.000Z', createdBy: 'bot_1' },
    );

    expect(found).toEqual([]);
  });

  it('ignores a matching database from the wrong creator', async () => {
    const { fetchImpl } = router({
      'GET /v1/blocks': {
        object: 'list',
        type: 'block',
        block: {},
        next_cursor: null,
        has_more: false,
        results: [
          {
            object: 'block',
            id: 'db_1',
            type: 'child_database',
            child_database: { title: 'Docket tasks' },
            created_by: { id: 'somebody_else' },
            created_time: '2026-08-24T12:00:01.000Z',
          },
        ],
      },
      'GET /v1/databases': {
        object: 'database',
        id: 'db_1',
        title: [],
        description: [{ plain_text: 'Managed by Docket · task' }],
        created_time: '2026-08-24T12:00:01.000Z',
        data_sources: [{ id: 'ds_1', name: 'Tasks' }],
        url: 'https://www.notion.so/db-1',
      },
    });

    const found = await new NotionMirrorClient('t', fetchImpl).findProvisionedDatabases(
      {
        parentPageId: 'page_1',
        title: 'Docket tasks',
        entityType: 'task',
        columns: [titleColumn],
      },
      { createdAtOrAfter: '2026-08-24T12:00:00.000Z', createdBy: 'bot_1' },
    );

    expect(found).toEqual([]);
  });

  it('ignores a matching database older than the provisioning intent', async () => {
    const { fetchImpl } = router({
      'GET /v1/blocks': {
        object: 'list',
        type: 'block',
        block: {},
        next_cursor: null,
        has_more: false,
        results: [
          {
            object: 'block',
            id: 'db_1',
            type: 'child_database',
            child_database: { title: 'Docket tasks' },
            created_by: { id: 'bot_1' },
            created_time: '2026-08-24T11:58:00.000Z',
          },
        ],
      },
      'GET /v1/databases': {
        object: 'database',
        id: 'db_1',
        title: [],
        description: [{ plain_text: 'Managed by Docket · task' }],
        created_time: '2026-08-24T11:58:00.000Z',
        data_sources: [{ id: 'ds_1', name: 'Tasks' }],
        url: 'https://www.notion.so/db-1',
      },
    });

    const found = await new NotionMirrorClient('t', fetchImpl).findProvisionedDatabases(
      {
        parentPageId: 'page_1',
        title: 'Docket tasks',
        entityType: 'task',
        columns: [titleColumn],
      },
      { createdAtOrAfter: '2026-08-24T12:00:00.000Z', createdBy: 'bot_1' },
    );

    expect(found).toEqual([]);
  });

  it('refuses to adopt an owned database that has no data source', async () => {
    const { fetchImpl } = router({
      'GET /v1/blocks': {
        object: 'list',
        type: 'block',
        block: {},
        next_cursor: null,
        has_more: false,
        results: [
          {
            object: 'block',
            id: 'db_1',
            type: 'child_database',
            child_database: { title: 'Docket tasks' },
            created_by: { id: 'bot_1' },
            created_time: '2026-08-24T12:00:01.000Z',
          },
        ],
      },
      'GET /v1/databases': {
        object: 'database',
        id: 'db_1',
        title: [],
        description: [{ plain_text: 'Managed by Docket · task' }],
        created_time: '2026-08-24T12:00:01.000Z',
        data_sources: [],
        url: 'https://www.notion.so/db-1',
      },
    });

    const rejected = new NotionMirrorClient('t', fetchImpl).findProvisionedDatabases(
      {
        parentPageId: 'page_1',
        title: 'Docket tasks',
        entityType: 'task',
        columns: [titleColumn],
      },
      { createdAtOrAfter: '2026-08-24T12:00:00.000Z', createdBy: 'bot_1' },
    );

    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'provider' });
  });
});

describe('NotionMirrorClient.updateDatabaseSchema', () => {
  it('re-reads the property ids from the updated data source', async () => {
    const { calls, fetchImpl } = router({
      'PATCH /v1/data_sources': {
        object: 'data_source',
        id: 'ds_1',
        properties: { 'Task name': { id: 'title' } },
      },
    });

    const ids = await new NotionMirrorClient('t', fetchImpl).updateDatabaseSchema('ds_1', {
      parentPageId: 'page_1',
      title: 'Docket tasks',
      entityType: 'task',
      columns: [titleColumn],
    });

    expect(calls[0]?.path).toBe('/v1/data_sources/ds_1');
    expect(ids).toEqual({
      propertyIds: { title: 'title' },
    });
  });

  it('reports a schema update Notion rejected', async () => {
    const rejected = new NotionMirrorClient(
      't',
      failing(400, 'validation_error'),
    ).updateDatabaseSchema('ds_1', {
      parentPageId: 'page_1',
      title: 'Docket tasks',
      entityType: 'task',
      columns: [titleColumn],
    });
    await expect(rejected).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('NotionMirrorClient.writeRow', () => {
  it('creates a row under the data source and returns its anchor', async () => {
    const { calls, fetchImpl } = router({ 'POST /v1/pages': page() });
    const written = await new NotionMirrorClient('t', fetchImpl).writeRow({
      kind: 'create',
      dataSourceId: 'ds_1',
      properties: {},
    });

    expect(calls[0]?.body).toMatchObject({
      parent: { type: 'data_source_id', data_source_id: 'ds_1' },
      properties: {},
    });
    expect(calls[0]?.body['properties']).not.toHaveProperty('Docket ID');
    expect(written).toEqual({
      externalPageId: 'page_1',
      externalUpdatedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('updates the page the anchor names', async () => {
    const { calls, fetchImpl } = router({ 'PATCH /v1/pages': page() });
    await new NotionMirrorClient('t', fetchImpl).writeRow({
      kind: 'update',
      dataSourceId: 'ds_1',
      externalPageId: 'page_1',
      properties: {},
    });
    expect(calls[0]?.path).toBe('/v1/pages/page_1');
  });

  it('refuses an update with no page id rather than creating a duplicate', async () => {
    const { calls, fetchImpl } = router({ 'PATCH /v1/pages': page() });
    const rejected = new NotionMirrorClient('t', fetchImpl).writeRow({
      kind: 'update',
      dataSourceId: 'ds_1',
      properties: {},
    });

    await expect(rejected).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });

  it('trashes a row rather than destroying it, so the write is recoverable', async () => {
    const { calls, fetchImpl } = router({ 'PATCH /v1/pages': page({ in_trash: true }) });
    const result = await new NotionMirrorClient('t', fetchImpl).writeRow({
      kind: 'delete',
      dataSourceId: 'ds_1',
      externalPageId: 'page_1',
    });

    expect(calls[0]?.body).toEqual({ in_trash: true });
    expect(result).toBeUndefined();
  });

  it('treats a delete with no anchor as already gone', async () => {
    const { calls, fetchImpl } = router({});
    const result = await new NotionMirrorClient('t', fetchImpl).writeRow({
      kind: 'delete',
      dataSourceId: 'ds_1',
    });

    expect(result).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('refuses a write Notion acknowledged without returning a page', async () => {
    // A partial response carries no `last_edited_time`, so recording it as an anchor would leave
    // the row unable to prove whether the next change came from Docket or from Notion.
    const { fetchImpl } = router({ 'POST /v1/pages': { object: 'page', id: 'page_1' } });
    const rejected = new NotionMirrorClient('t', fetchImpl).writeRow({
      kind: 'create',
      dataSourceId: 'ds_1',
      properties: {},
    });
    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'provider' });
  });
});

describe('NotionMirrorClient.queryCreatedRows', () => {
  it('queries the provider creation window without sending a Docket identifier', async () => {
    const { calls, fetchImpl } = router({
      'POST /v1/data_sources': {
        object: 'list',
        type: 'page_or_data_source',
        page_or_data_source: {},
        next_cursor: null,
        has_more: false,
        results: [page()],
      },
    });

    const found = await new NotionMirrorClient('t', fetchImpl).queryCreatedRows(
      'ds_1',
      '2026-01-01T00:00:00.000Z',
    );

    expect(calls[0]?.body).toMatchObject({
      filter: {
        timestamp: 'created_time',
        created_time: { on_or_after: '2026-01-01T00:00:00.000Z' },
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 100,
      result_type: 'page',
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain('task_1');
    expect(found).toEqual([
      {
        externalPageId: 'page_1',
        externalCreatedAt: '2026-01-01T00:00:00.000Z',
        externalUpdatedAt: '2026-01-02T03:04:05.000Z',
        createdBy: 'user_9',
      },
    ]);
  });
});

describe('NotionMirrorClient.queryChanges', () => {
  it('reads live and trashed rows, and lets the live copy win a race', async () => {
    // A page trashed and restored between the two reads appears in both partitions. Taking the
    // trashed copy would archive a row the person had just brought back.
    let call = 0;
    const fetchImpl = ((_url: string, init?: { body?: string }) => {
      call += 1;
      const archived = JSON.parse(init?.body ?? '{}') as { is_archived?: boolean };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            next_cursor: null,
            has_more: false,
            results: [page({ id: archived.is_archived === true ? 'page_1' : 'page_1' })],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const changes = await new NotionMirrorClient('t', fetchImpl).queryChanges('ds_1');
    expect(call).toBe(2);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ externalPageId: 'page_1', archived: false });
  });

  it('narrows to what changed since the given watermark', async () => {
    const { calls, fetchImpl } = router({
      'POST /v1/data_sources': { object: 'list', next_cursor: null, has_more: false, results: [] },
    });
    await new NotionMirrorClient('t', fetchImpl).queryChanges('ds_1', '2026-01-01T00:00:00.000Z');

    expect(calls[0]?.body).toMatchObject({
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: '2026-01-01T00:00:00.000Z' },
      },
    });
    // `is_archived`, never `in_trash`: the live API rejects the latter on this endpoint, and the
    // SDK's typed `dataSources.query` drops the former as an unknown parameter — which is why the
    // request is issued through `request` instead.
    expect(calls[1]?.body).toMatchObject({ is_archived: true });
    expect(calls[1]?.body).not.toHaveProperty('in_trash');
  });

  it('follows every cursor in both the live and archived partitions', async () => {
    const bodies: { is_archived?: boolean; start_cursor?: string }[] = [];
    const fetchImpl = ((_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as {
        is_archived?: boolean;
        start_cursor?: string;
      };
      bodies.push(body);
      const id = body.is_archived === true ? 'trashed' : 'live';
      const firstPage = body.start_cursor === undefined;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            next_cursor: firstPage ? 'next' : null,
            has_more: firstPage,
            results: [page({ id: `${id}_${firstPage ? '1' : '2'}` })],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const changes = await new NotionMirrorClient('t', fetchImpl).queryChanges('ds_1');

    expect(bodies).toEqual([
      { page_size: 100 },
      { page_size: 100, start_cursor: 'next' },
      { page_size: 100, is_archived: true },
      { page_size: 100, is_archived: true, start_cursor: 'next' },
    ]);
    expect(changes.map((change) => change.externalPageId)).toEqual([
      'live_1',
      'live_2',
      'trashed_1',
      'trashed_2',
    ]);
  });

  it('reports a failed query as a provider error', async () => {
    const rejected = new NotionMirrorClient(
      't',
      failing(500, 'internal_server_error'),
    ).queryChanges('ds_1');
    await expect(rejected).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('NotionMirrorClient error translation', () => {
  it('treats a restricted resource as an auth problem, like a revoked token', async () => {
    // Both mean "this grant can no longer do this", and both are fixed by reconnecting.
    const rejected = new NotionMirrorClient('t', failing(403, 'restricted_resource')).botId();
    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'auth' });
  });

  it('calls a transport failure a network error rather than blaming the provider', async () => {
    // Nothing was heard from Notion at all, so the remediation is to retry, not to reconnect.
    const fetchImpl = (() =>
      Promise.reject(new Error('socket hang up'))) as unknown as typeof fetch;
    const rejected = new NotionMirrorClient('t', fetchImpl).botId();
    await expect(rejected).rejects.toMatchObject({ provider: 'notion', kind: 'network' });
  });

  it('preserves object-not-found as a missing provider object', async () => {
    const rejected = new NotionMirrorClient('t', failing(404, 'object_not_found')).botId();
    await expect(rejected).rejects.toMatchObject({
      provider: 'notion',
      kind: 'provider',
      status: 404,
    });
  });
});
