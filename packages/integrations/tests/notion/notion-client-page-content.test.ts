import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../../src/connector-error';
import { RecordingHttp, notion, trackerSchemaPayload } from './notion-client-harness';
import { TASKS_TRACKER_DATA_SOURCE, tasksTrackerPage } from './notion-fixtures';

describe('NotionProviderClient.importWork — unreadable page bodies', () => {
  function httpWithBody(markdown: () => unknown): RecordingHttp {
    const http = new RecordingHttp();
    http.get = (path) => (path === '/pages/page-body/markdown' ? markdown() : trackerSchemaPayload);
    http.post = (path, body) => {
      if (!path.endsWith('/query') || (body as Record<string, unknown>)['is_archived'] === true) {
        return { results: [], has_more: false };
      }
      return {
        results: [tasksTrackerPage({ id: 'page-body', description: 'Short property text' })],
        has_more: false,
      };
    };
    return http;
  }

  async function importOne(http: RecordingHttp) {
    const [item] = await notion(http).importWork(
      { connectionId: 'c', provider: 'notion', listIds: [TASKS_TRACKER_DATA_SOURCE] },
      '2026-08-02T00:00:00.000Z',
    );
    return item;
  }

  it('marks the body unavailable when Notion truncates the page', async () => {
    const item = await importOne(httpWithBody(() => ({ markdown: 'partial', truncated: true })));

    expect(item?.bodyUnavailable).toBe(true);
    expect(item?.body).toBe('Short property text');
  });

  it('keeps the Description text for a page whose content the connection cannot read', async () => {
    const item = await importOne(
      httpWithBody(() => {
        throw new ConnectorError('forbidden', { provider: 'notion', kind: 'auth', status: 403 });
      }),
    );

    expect(item?.bodyUnavailable).toBe(true);
    expect(item?.body).toBe('Short property text');
  });

  it('imports an empty page body as an empty description', async () => {
    const item = await importOne(httpWithBody(() => ({ markdown: '', truncated: false })));

    expect(item?.bodyUnavailable).toBeUndefined();
    expect(item?.body).toBe('');
  });
});

describe('NotionProviderClient.pushTask — page content access', () => {
  it('sends no content write for a new page with an empty description', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.post = () => ({ id: 'new-page', last_edited_time: '2026-08-03T10:00:00.000Z' });

    const result = await notion(http).pushTask({
      kind: 'create',
      listId: TASKS_TRACKER_DATA_SOURCE,
      title: 'Brand new',
      notes: null,
      completed: false,
    });

    expect(http.calls.filter((call) => call.method === 'patch')).toEqual([]);
    expect(result).toEqual({
      externalId: 'new-page',
      externalUpdatedAt: '2026-08-03T10:00:00.000Z',
    });
  });

  it.each([
    [403, 'auth', 'inaccessible'],
    [400, 'provider', 'rejected'],
  ] as const)(
    'keeps the property write when Notion answers the content write with %i',
    async (status, kind, contentState) => {
      const http = new RecordingHttp();
      http.get = () => trackerSchemaPayload;
      http.patch = (path) => {
        if (path === '/pages/page-1/markdown') {
          throw new ConnectorError('refused', { provider: 'notion', kind, status });
        }
        return { object: 'page', id: 'page-1', last_edited_time: '2026-08-03T10:00:00.000Z' };
      };

      const result = await notion(http).pushTask({
        kind: 'update',
        listId: TASKS_TRACKER_DATA_SOURCE,
        externalId: 'page-1',
        title: 'Docket’s title',
        notes: '# Full body',
      });

      expect(http.calls).toContainEqual(
        expect.objectContaining({ method: 'patch', path: '/pages/page-1' }),
      );
      expect(result).toEqual({
        externalId: 'page-1',
        externalUpdatedAt: '2026-08-03T10:00:00.000Z',
        contentState,
      });
    },
  );

  it('rethrows any other content write failure', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.patch = (path) => {
      if (path === '/pages/page-1/markdown') {
        throw new ConnectorError('down', { provider: 'notion', kind: 'provider', status: 502 });
      }
      return { object: 'page', id: 'page-1', last_edited_time: '2026-08-03T10:00:00.000Z' };
    };

    await expect(
      notion(http).pushTask({
        kind: 'update',
        listId: TASKS_TRACKER_DATA_SOURCE,
        externalId: 'page-1',
        notes: '# Full body',
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });

  it('leaves the page body and Description alone when the notes are unchanged', async () => {
    const http = new RecordingHttp();
    http.get = () => trackerSchemaPayload;
    http.patch = () => ({
      object: 'page',
      id: 'page-1',
      last_edited_time: '2026-08-03T10:00:00.000Z',
    });

    await notion(http).pushTask({
      kind: 'update',
      listId: TASKS_TRACKER_DATA_SOURCE,
      externalId: 'page-1',
      title: 'Docket’s title',
      notes: null,
      notesUnchanged: true,
    });

    const patches = http.calls.filter((call) => call.method === 'patch');
    expect(patches.map((call) => call.path)).toEqual(['/pages/page-1']);
    expect(patches[0]?.body).toEqual({
      properties: {
        'Task name': { title: [{ type: 'text', text: { content: 'Docket’s title' } }] },
      },
    });
  });
});
