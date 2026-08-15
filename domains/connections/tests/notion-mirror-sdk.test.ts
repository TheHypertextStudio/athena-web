import { describe, expect, it, vi } from 'vitest';

import type { PageObjectResponse } from '@notionhq/client';
import { NotionPropertyKind } from '../src/notion/mirror-contract';
import { ProviderError } from '../src/provider-error';
import {
  NotionMirrorClient,
  columnSchema,
  databaseSchema,
  readPropertyIds,
  toParentPage,
} from '../src/notion/adapters/notion-sdk';
import type { MirrorColumnSpec } from '../src/notion/mirror-port';

const col = (
  over: Partial<MirrorColumnSpec> & Pick<MirrorColumnSpec, 'kind'>,
): MirrorColumnSpec => ({
  field: over.field ?? 'f',
  title: over.title ?? 'T',
  kind: over.kind,
  ...(over.relationDataSourceId !== undefined
    ? { relationDataSourceId: over.relationDataSourceId }
    : {}),
  ...(over.options !== undefined ? { options: over.options } : {}),
});

describe('columnSchema', () => {
  it('emits a shape keyed by the Notion property type for every kind Docket declares', () => {
    // The catalog and the builder are the two halves of "Docket can provision this"; a kind the
    // builder cannot render would be a column the designer offers and provisioning then rejects.
    for (const kind of NotionPropertyKind.options) {
      const spec = col({
        kind,
        ...(kind === 'relation' ? { relationDataSourceId: 'ds_1' } : {}),
      });
      expect(Object.keys(columnSchema(spec)), kind).toEqual([kind]);
    }
  });

  it('carries select options through as Notion name objects', () => {
    expect(columnSchema(col({ kind: 'select', options: ['To do', 'Done'] }))).toEqual({
      select: { options: [{ name: 'To do' }, { name: 'Done' }] },
    });
  });

  it('sends an empty option list rather than omitting it when a select has no values yet', () => {
    // A brand-new workspace has no states to derive options from. Notion accepts an empty set and
    // the sync fills it in later; omitting `options` entirely is a 400.
    expect(columnSchema(col({ kind: 'select' }))).toEqual({ select: { options: [] } });
  });

  it('declares no options for a status property, because Notion owns its groups', () => {
    expect(columnSchema(col({ kind: 'status' }))).toEqual({ status: {} });
  });

  it('points a relation at its target data source', () => {
    expect(columnSchema(col({ kind: 'relation', relationDataSourceId: 'ds_42' }))).toEqual({
      relation: { data_source_id: 'ds_42', single_property: {} },
    });
  });

  it('refuses a relation with no target instead of guessing one', () => {
    // Guessing would silently wire the column to the wrong table, which is worse than failing:
    // the database provisions successfully and every row then relates to the wrong records.
    expect(() => columnSchema(col({ kind: 'relation', title: 'Project' }))).toThrow(ProviderError);
    expect(() => columnSchema(col({ kind: 'relation', title: 'Project' }))).toThrow(/Project/);
  });
});

describe('databaseSchema', () => {
  it('keys the schema by column title, which is what Notion expects', () => {
    const schema = databaseSchema([
      col({ field: 'title', title: 'Task name', kind: 'title' }),
      col({ field: 'dueDate', title: 'Due', kind: 'date' }),
    ]);
    expect(Object.keys(schema)).toEqual(['Task name', 'Due']);
  });

  it('uses the user-chosen title, not the Docket field key', () => {
    const schema = databaseSchema([col({ field: 'assignee', title: 'DRI', kind: 'rich_text' })]);
    expect(schema).toHaveProperty('DRI');
    expect(schema).not.toHaveProperty('assignee');
  });
});

describe('readPropertyIds', () => {
  it('correlates Docket fields to Notion property ids by the title Docket just chose', () => {
    // This is the only moment the two can be correlated unambiguously — right after Docket named
    // the columns. Every later call binds by the id captured here.
    const ids = readPropertyIds(
      [
        col({ field: 'title', title: 'Task name', kind: 'title' }),
        col({ field: 'assignee', title: 'Owner', kind: 'rich_text' }),
      ],
      { 'Task name': { id: 'title' }, Owner: { id: 'a%3Db' } },
    );
    expect(ids).toEqual({ title: 'title', assignee: 'a%3Db' });
  });

  it('omits a column Notion did not create rather than recording a blank id', () => {
    // A binding with an empty id would look provisioned and then address nothing.
    const ids = readPropertyIds(
      [
        col({ field: 'title', title: 'Name', kind: 'title' }),
        col({ field: 'ghost', title: 'Ghost', kind: 'rich_text' }),
      ],
      { Name: { id: 'title' } },
    );
    expect(ids).toEqual({ title: 'title' });
  });

  it('ignores a property whose id came back empty', () => {
    const ids = readPropertyIds([col({ field: 'title', title: 'Name', kind: 'title' })], {
      Name: { id: '' },
    });
    expect(ids).toEqual({});
  });
});

describe('toParentPage', () => {
  const page = (over: Record<string, unknown>): PageObjectResponse =>
    ({
      object: 'page',
      id: 'page_1',
      url: 'https://www.notion.so/page-1',
      last_edited_time: '2026-01-02T03:04:05.000Z',
      parent: { type: 'workspace', workspace: true },
      icon: null,
      properties: { Name: { type: 'title', title: [{ plain_text: 'Roadmap' }] } },
      ...over,
    }) as unknown as PageObjectResponse;

  it('carries the three things that tell two same-named pages apart', () => {
    // Resolving each result's parent *title* would be one extra request per row per keystroke.
    // These three come free on the search result and do the same job.
    expect(toParentPage(page({ icon: { type: 'emoji', emoji: '🗺️' } }))).toEqual({
      id: 'page_1',
      title: 'Roadmap',
      url: 'https://www.notion.so/page-1',
      icon: '🗺️',
      lastEditedTime: '2026-01-02T03:04:05.000Z',
      parentKind: 'workspace',
    });
  });

  it('drops a hosted icon rather than making the picker fetch it', () => {
    // An authenticated image request per option, for decoration, with a URL that expires.
    const mapped = toParentPage(
      page({ icon: { type: 'external', external: { url: 'https://example.com/i.png' } } }),
    );
    expect(mapped.icon).toBeUndefined();
  });

  it('reports where the page sits for every parent Notion names', () => {
    expect(toParentPage(page({ parent: { type: 'page_id', page_id: 'p' } })).parentKind).toBe(
      'page',
    );
    expect(
      toParentPage(page({ parent: { type: 'data_source_id', data_source_id: 'd' } })).parentKind,
    ).toBe('database');
    expect(toParentPage(page({ parent: { type: 'block_id', block_id: 'b' } })).parentKind).toBe(
      undefined,
    );
  });

  it('falls back to Untitled rather than rendering a nameless row', () => {
    expect(toParentPage(page({ properties: {} })).title).toBe('Untitled');
  });
});

describe('NotionMirrorClient.listParentPages', () => {
  /** Capture the request the SDK makes, and answer with an empty search result. */
  function captureSearch(): { body: () => Record<string, unknown>; fetchImpl: typeof fetch } {
    let seen: Record<string, unknown> = {};
    const fetchImpl = ((_url: string, init?: { body?: string }) => {
      seen = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return Promise.resolve(
        new Response(JSON.stringify({ object: 'list', results: [], next_cursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    return { body: () => seen, fetchImpl };
  }

  it('asks Notion to do the narrowing and the ordering', async () => {
    // The whole point of the change: `search` takes both a title query and a `last_edited_time`
    // sort, so a workspace is never downloaded to be filtered in a browser. The previous version
    // sent neither — and its docstring claimed an ordering it never requested.
    const { body, fetchImpl } = captureSearch();
    await new NotionMirrorClient('token', fetchImpl).listParentPages({ query: ' roadmap ' });

    expect(body()).toMatchObject({
      query: 'roadmap',
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
    });
  });

  it('omits the query entirely when nothing has been typed', async () => {
    // An empty `query` is not the same request as no query; sending one narrows to nothing.
    const { body, fetchImpl } = captureSearch();
    await new NotionMirrorClient('token', fetchImpl).listParentPages({ query: '   ' });
    expect(body()).not.toHaveProperty('query');
  });

  it('asks for one page, not the whole workspace, and forwards the cursor', async () => {
    const { body, fetchImpl } = captureSearch();
    await new NotionMirrorClient('token', fetchImpl).listParentPages({ limit: 25, cursor: 'c1' });
    expect(body()).toMatchObject({ page_size: 25, start_cursor: 'c1' });
  });

  it('clamps a caller asking for more than Notion allows', async () => {
    const { body, fetchImpl } = captureSearch();
    await new NotionMirrorClient('token', fetchImpl).listParentPages({ limit: 5000 });
    expect(body()).toMatchObject({ page_size: 100 });
  });
});

describe('NotionMirrorClient provider failures', () => {
  it('classifies an unauthorized Notion response as an auth error', async () => {
    // The sync spine only asks a person to reconnect when the provider edge preserves this
    // distinction. Collapsing a revoked grant into a generic provider error would leave the
    // integration broken without the one actionable remedy.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            object: 'error',
            status: 401,
            code: 'unauthorized',
            message: 'API token is invalid.',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    const rejected = new NotionMirrorClient('revoked-token', fetchImpl).botId();
    await expect(rejected).rejects.toBeInstanceOf(ProviderError);
    await expect(rejected).rejects.toMatchObject({
      provider: 'notion',
      kind: 'auth',
    });
  });

  it('classifies a rate-limited Notion SDK response as a retryable rate-limit error', async () => {
    // This is an SDK-shaped 429 response, not a hand-built ProviderError. The adapter boundary
    // has to retain the remediation category after the SDK has retried and finally given up.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            object: 'error',
            status: 429,
            code: 'rate_limited',
            message: 'Rate limit exceeded.',
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          },
        ),
    ) as unknown as typeof fetch;

    const rejected = new NotionMirrorClient('limited-token', fetchImpl).botId();
    await expect(rejected).rejects.toBeInstanceOf(ProviderError);
    await expect(rejected).rejects.toMatchObject({
      provider: 'notion',
      kind: 'rate_limit',
      retryable: true,
    });
  });
});
