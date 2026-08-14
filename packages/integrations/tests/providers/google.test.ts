/**
 * Direct unit tests for the Google product clients (`GoogleCalendarProviderClient`,
 * `GoogleTasksProviderClient`) driven through a recording `ProviderHttp` double, covering the
 * paths `real-connector.test.ts`'s end-to-end scenarios don't reach: Calendar's `mirrorStatus`,
 * the shared pagination truncation bound, and every `pushTask`/field-mapping branch of Google
 * Tasks write-back.
 */
import { describe, expect, it, vi } from 'vitest';

import { ConnectorError } from '../../src/connector-error';
import { GoogleCalendarProviderClient, GoogleTasksProviderClient } from '../../src/google';
import type { ProviderHttp } from '../../src/provider-http';
import { assertDefined } from '@docket/test-utils';

/** One HTTP call the fake recorded, for assertions. */
interface RecordedCall {
  readonly method: 'get' | 'post' | 'patch' | 'delete';
  readonly path: string;
  readonly body?: unknown;
}

/** A record-only ProviderHttp double — captures calls and answers via a per-test router. */
class RecordingHttp {
  readonly calls: RecordedCall[] = [];
  /** Route a GET path to its canned JSON; throw to simulate an HTTP error. */
  respond: (path: string) => unknown = () => ({});
  async getJson<T = unknown>(path: string): Promise<T> {
    this.calls.push({ method: 'get', path });
    return this.respond(path) as T;
  }
  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'post', path, body });
    return this.respond(path) as T;
  }
  async patchJson<T = unknown>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'patch', path, body });
    return this.respond(path) as T;
  }
  async deleteVoid(path: string): Promise<void> {
    this.calls.push({ method: 'delete', path });
  }
}

function calendarClient(http: RecordingHttp): GoogleCalendarProviderClient {
  return new GoogleCalendarProviderClient(http as unknown as ProviderHttp);
}

function tasksClient(http: RecordingHttp): GoogleTasksProviderClient {
  return new GoogleTasksProviderClient(http as unknown as ProviderHttp);
}

describe('GoogleCalendarProviderClient.resolveAccount', () => {
  it('returns undefined when the primary calendar has neither id nor summary', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    expect(await calendarClient(http).resolveAccount()).toBeUndefined();
  });
});

describe('GoogleCalendarProviderClient.importWork', () => {
  it('tolerates an events page with no items key', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    const items = await calendarClient(http).importWork(
      { connectionId: 'c1', provider: 'calendar' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items).toEqual([]);
  });
});

describe('GoogleCalendarProviderClient.listContainers', () => {
  it('has no container concept and returns empty', async () => {
    const http = new RecordingHttp();
    await expect(calendarClient(http).listContainers()).resolves.toEqual([]);
  });
});

describe('GoogleCalendarProviderClient.mirrorStatus', () => {
  it('sizes the mirror from the primary calendar event count', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({
      items: [
        { id: 'e1', summary: 'One' },
        { id: 'e2', summary: 'Two' },
      ],
    });
    const status = await calendarClient(http).mirrorStatus({
      connectionId: 'c1',
      provider: 'calendar',
    });
    expect(status).toEqual({ connectionId: 'c1', status: 'idle', itemCount: 2 });
  });
});

describe('paginateGoogle truncation (via Calendar events)', () => {
  it('stops at MAX_IMPORT_PAGES and logs a truncation warning when every page is full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const http = new RecordingHttp();
      let call = 0;
      // Every page returns a nextPageToken, so the loop only stops at the safety bound.
      http.respond = () => {
        call += 1;
        return { items: [{ id: `e${call}` }], nextPageToken: `p${call}` };
      };
      const items = await calendarClient(http).importWork(
        { connectionId: 'c1', provider: 'calendar' },
        '2026-01-01T00:00:00.000Z',
      );
      expect(items).toHaveLength(100);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(assertDefined(warn.mock.calls[0])[0]).toContain('import_truncated');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('GoogleTasksProviderClient.listContainers / fetchTaskLists', () => {
  it('falls back to the list id as the title when the list has none', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ items: [{ id: 'l1' }] });
    expect(await tasksClient(http).listContainers()).toEqual([{ id: 'l1', title: 'l1' }]);
  });

  it('follows the pageToken across a second listing page', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.includes('pageToken=p2')) return { items: [{ id: 'l2', title: 'Two' }] };
      expect(path).not.toContain('pageToken');
      return { items: [{ id: 'l1', title: 'One' }], nextPageToken: 'p2' };
    };
    expect(await tasksClient(http).listContainers()).toEqual([
      { id: 'l1', title: 'One' },
      { id: 'l2', title: 'Two' },
    ]);
  });
});

describe('GoogleTasksProviderClient.importWork', () => {
  it('tolerates a task-lists page and a tasks page with no items key', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    const items = await tasksClient(http).importWork(
      { connectionId: 'c1', provider: 'gtasks' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items).toEqual([]);
  });

  it('tolerates a tasks page with no items key for a list that does have tasks lists', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/@me/lists')) return { items: [{ id: 'l1', title: 'List' }] };
      // The tasks page for list l1 omits `items` entirely (an empty list can come back
      // this way rather than as `items: []`).
      return {};
    };
    const items = await tasksClient(http).importWork(
      { connectionId: 'c1', provider: 'gtasks' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items).toEqual([]);
  });

  it('follows the pageToken across a second tasks page within one list', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/@me/lists')) return { items: [{ id: 'l1', title: 'List' }] };
      if (path.includes('pageToken=p2')) return { items: [{ id: 't2', status: 'needsAction' }] };
      expect(path).toContain('/lists/l1/tasks');
      return { items: [{ id: 't1', status: 'needsAction' }], nextPageToken: 'p2' };
    };
    const items = await tasksClient(http).importWork(
      { connectionId: 'c1', provider: 'gtasks' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items.map((i) => i.id)).toEqual(['t1', 't2']);
  });

  it('carries the due date through and marks a deleted task removed', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/@me/lists')) return { items: [{ id: 'l1', title: 'List' }] };
      return {
        items: [
          { id: 't1', status: 'needsAction', due: '2026-03-01T00:00:00.000Z' },
          { id: 't2', status: 'needsAction', deleted: true },
        ],
      };
    };
    const items = await tasksClient(http).importWork(
      { connectionId: 'c1', provider: 'gtasks' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items[0]).toMatchObject({ id: 't1', dueDate: '2026-03-01T00:00:00.000Z' });
    expect(items[1]).toMatchObject({ id: 't2', removed: true });
  });
});

describe('GoogleTasksProviderClient.pushTask', () => {
  it('create: sends the mapped fields and returns the post-write anchors including etag', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ id: 'gt1', updated: '2026-01-01T00:00:00Z', etag: 'e1' });
    const result = await tasksClient(http).pushTask({
      kind: 'create',
      listId: 'l1',
      title: 'New task',
      notes: 'notes here',
      dueDate: '2026-02-01',
      completed: false,
    });
    expect(result).toEqual({
      externalId: 'gt1',
      externalUpdatedAt: '2026-01-01T00:00:00Z',
      externalEtag: 'e1',
    });
    expect(http.calls[0]).toEqual({
      method: 'post',
      path: '/lists/l1/tasks',
      body: {
        title: 'New task',
        notes: 'notes here',
        due: '2026-02-01',
        status: 'needsAction',
        completed: null,
      },
    });
  });

  it('create: marks status completed (no completed:null) when completed is true', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ id: 'gt2', updated: '2026-01-01T00:00:00Z' });
    await tasksClient(http).pushTask({
      kind: 'create',
      listId: 'l1',
      title: 'Done already',
      completed: true,
    });
    expect(http.calls[0]?.body).toEqual({ title: 'Done already', status: 'completed' });
  });

  it('update: PATCHes only the supplied fields, clearing notes/dueDate with an explicit null', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ id: 'gt3', updated: '2026-01-02T00:00:00Z' });
    const result = await tasksClient(http).pushTask({
      kind: 'update',
      listId: 'l1',
      externalId: 'gt3',
      notes: null,
      dueDate: null,
      completed: false,
    });
    expect(result).toEqual({ externalId: 'gt3', externalUpdatedAt: '2026-01-02T00:00:00Z' });
    expect(http.calls[0]).toEqual({
      method: 'patch',
      path: '/lists/l1/tasks/gt3',
      body: { notes: null, due: null, status: 'needsAction', completed: null },
    });
  });

  it('update: omits fields that were not supplied at all', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ id: 'gt4', updated: '2026-01-02T00:00:00Z' });
    await tasksClient(http).pushTask({ kind: 'update', listId: 'l1', externalId: 'gt4' });
    expect(http.calls[0]?.body).toEqual({});
  });

  it('delete: issues a DELETE and resolves undefined without a write result', async () => {
    const http = new RecordingHttp();
    const result = await tasksClient(http).pushTask({
      kind: 'delete',
      listId: 'l1',
      externalId: 'gt5',
    });
    expect(result).toBeUndefined();
    expect(http.calls).toEqual([{ method: 'delete', path: '/lists/l1/tasks/gt5' }]);
  });

  it('throws a provider ConnectorError when the write response is missing id/updated', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    await expect(
      tasksClient(http).pushTask({ kind: 'create', listId: 'l1', title: 'X', completed: false }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});
