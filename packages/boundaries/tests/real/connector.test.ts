/**
 * Tests for the real, env-driven {@link RealConnector} and its per-provider clients.
 *
 * @remarks
 * Every request-building and response-mapping path is exercised through an injected
 * fake {@link HttpClient} that records calls and returns scripted responses, so no
 * network is touched. The only un-unit-testable line — the real `globalThis.fetch`
 * call in `defaultHttpClient` — is covered by `real.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { RealConnector } from '../../src/real/connector';
import type { HttpClient } from '../../src/real/http';

/** One recorded HTTP call: the URL and the (optional) request init. */
interface RecordedCall {
  readonly url: string;
  readonly init?: RequestInit;
}

/** A fake {@link HttpClient} that records calls and returns scripted responses in order. */
function fakeHttp(responses: Response[]): { http: HttpClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const http: HttpClient = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const res = responses[index];
    index += 1;
    if (!res) throw new Error(`fakeHttp: no scripted response for call #${index}`);
    return res;
  };
  return { http, calls };
}

/** Read a recorded request body that is known to be a string. */
function bodyText(call: RecordedCall): string {
  return call.init?.body as string;
}

/** Read one header value off a recorded request's headers record. */
function header(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string>)[name];
}

describe('RealConnector — GitHub (REST)', () => {
  it('defaults the API base, connects with the login, and sends a bearer token', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(result).toEqual({
      connectionId: 'github:org_1',
      provider: 'github',
      status: 'connected',
      account: 'octocat',
    });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.github.com/user');
    expect(call.init?.method).toBe('GET');
    expect(header(call, 'Authorization')).toBe('Bearer tok');
    expect(header(call, 'Accept')).toBe('application/json');
  });

  it('falls back to the GitHub name when login is absent', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ name: 'Octo Cat' }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(result.account).toBe('Octo Cat');
    expect(result.status).toBe('connected');
  });

  it('reports an error status (and omits account) when the identity call fails', async () => {
    const { http } = fakeHttp([new Response('forbidden', { status: 401 })]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'bad' }, http);
    const result = await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(result.status).toBe('error');
    expect(result).not.toHaveProperty('account');
  });

  it('reports an error status when the identity has neither login nor name', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(result.status).toBe('error');
    expect(result).not.toHaveProperty('account');
  });

  it('imports issues with provenance from html_url and issue number', async () => {
    const { http, calls } = fakeHttp([
      new Response(
        JSON.stringify([
          {
            id: 1001,
            number: 42,
            title: 'Fix flaky test',
            body: 'It fails on CI.',
            html_url: 'https://github.com/octo/docket/issues/42',
          },
        ]),
        { status: 200 },
      ),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const items = await connector.importWork({ connectionId: 'c1', provider: 'github' });
    expect(calls[0]!.url).toBe('https://api.github.com/issues?filter=all&state=open&per_page=100');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: '1001',
      kind: 'issue',
      title: 'Fix flaky test',
      body: 'It fails on CI.',
      provenance: {
        provider: 'github',
        externalId: '42',
        externalUrl: 'https://github.com/octo/docket/issues/42',
      },
    });
    expect(items[0]?.provenance.importedAt).toMatch(/Z$/);
  });

  it('omits body when null/absent and tolerates a non-array response', async () => {
    const { http } = fakeHttp([
      new Response(
        JSON.stringify([{ id: 2, number: 7, title: 'T2', body: null, html_url: 'https://x/7' }]),
        { status: 200 },
      ),
      new Response(JSON.stringify({ message: 'oops' }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const withItem = await connector.importWork({ connectionId: 'c1', provider: 'github' });
    expect(withItem[0]).not.toHaveProperty('body');
    const empty = await connector.importWork({ connectionId: 'c1', provider: 'github' });
    expect(empty).toEqual([]);
  });

  it('throws when an import API call fails', async () => {
    const { http } = fakeHttp([new Response('boom', { status: 503 })]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    await expect(connector.importWork({ connectionId: 'c1', provider: 'github' })).rejects.toThrow(
      /github API GET \/issues.* failed: 503/,
    );
  });

  it('reports mirror status sized from the all-state issue listing', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify([{ id: 1, number: 1, title: 'a', html_url: 'u' }]), {
        status: 200,
      }),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'github' });
    expect(calls[0]!.url).toBe('https://api.github.com/issues?filter=all&state=all&per_page=100');
    expect(status).toEqual({ connectionId: 'c1', status: 'idle', itemCount: 1 });
  });

  it('defaults mirror itemCount to 0 on a non-array response', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'github' });
    expect(status.itemCount).toBe(0);
  });

  it('resolves the canonical issue url for an owner/repo#number external id', async () => {
    const { http, calls } = fakeHttp([]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const link = await connector.linkResource({
      connectionId: 'c1',
      provider: 'github',
      resourceId: 'r1',
      externalId: 'octo/docket#42',
    });
    expect(link).toEqual({
      resourceId: 'r1',
      externalId: 'octo/docket#42',
      externalUrl: 'https://github.com/octo/docket/issues/42',
      linked: true,
    });
    expect(calls).toHaveLength(0);
  });

  it('resolves the repo url for an owner/repo external id and links others without a url', async () => {
    const { http } = fakeHttp([]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const repo = await connector.linkResource({
      connectionId: 'c1',
      provider: 'github',
      resourceId: 'r1',
      externalId: 'octo/docket',
    });
    expect(repo.externalUrl).toBe('https://github.com/octo/docket');
    const opaque = await connector.linkResource({
      connectionId: 'c1',
      provider: 'github',
      resourceId: 'r2',
      externalId: 'just-an-id',
    });
    expect(opaque).toEqual({ resourceId: 'r2', externalId: 'just-an-id', linked: true });
  });

  it('honors a custom apiBase (GitHub Enterprise)', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ login: 'x' }), { status: 200 }),
    ]);
    const connector = new RealConnector(
      { provider: 'github', accessToken: 'tok', apiBase: 'https://ghe.local/api/v3' },
      http,
    );
    await connector.connect({ provider: 'github', referenceId: 'o' });
    expect(calls[0]!.url).toBe('https://ghe.local/api/v3/user');
  });
});

describe('RealConnector — Linear (GraphQL)', () => {
  it('connects via the viewer query and posts a bearer-authenticated GraphQL request', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ data: { viewer: { name: 'Ada', email: 'ada@x.dev' } } }), {
        status: 200,
      }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'lin_tok' }, http);
    const result = await connector.connect({ provider: 'linear', referenceId: 'org_1' });
    expect(result).toEqual({
      connectionId: 'linear:org_1',
      provider: 'linear',
      status: 'connected',
      account: 'Ada',
    });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.linear.app/graphql');
    expect(call.init?.method).toBe('POST');
    expect(header(call, 'Authorization')).toBe('Bearer lin_tok');
    expect(header(call, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(bodyText(call)).query).toContain('viewer');
  });

  it('falls back to the viewer email when name is absent', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ data: { viewer: { email: 'only@x.dev' } } }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'linear', referenceId: 'o' });
    expect(result.account).toBe('only@x.dev');
  });

  it('imports issues mapping identifier/url/description into provenance', async () => {
    const { http, calls } = fakeHttp([
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: 'uuid-1',
                  identifier: 'DOC-7',
                  title: 'Design the Hub',
                  description: 'Spec the landing surface.',
                  url: 'https://linear.app/docket/issue/DOC-7',
                },
                {
                  id: 'uuid-2',
                  identifier: 'DOC-8',
                  title: 'No body',
                  description: null,
                  url: 'u',
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const items = await connector.importWork({ connectionId: 'c1', provider: 'linear' });
    expect(JSON.parse(bodyText(calls[0]!)).query).toContain('issues');
    expect(items[0]).toEqual({
      id: 'uuid-1',
      kind: 'issue',
      title: 'Design the Hub',
      body: 'Spec the landing surface.',
      provenance: {
        provider: 'linear',
        externalId: 'DOC-7',
        externalUrl: 'https://linear.app/docket/issue/DOC-7',
        importedAt: items[0]!.provenance.importedAt,
      },
    });
    expect(items[1]).not.toHaveProperty('body');
  });

  it('tolerates a missing nodes array on import', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ data: { issues: {} } }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    expect(await connector.importWork({ connectionId: 'c1', provider: 'linear' })).toEqual([]);
  });

  it('surfaces GraphQL errors as a thrown error', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ errors: [{ message: 'Bad token' }] }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    await expect(connector.importWork({ connectionId: 'c1', provider: 'linear' })).rejects.toThrow(
      /linear GraphQL error: Bad token/,
    );
  });

  it('reports an error status when the GraphQL response is missing data', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    await expect(
      connector.connect({ provider: 'linear', referenceId: 'o' }),
    ).resolves.toMatchObject({ status: 'error' });
  });

  it('throws when the GraphQL endpoint returns a non-2xx status', async () => {
    const { http } = fakeHttp([new Response('nope', { status: 500 })]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    await expect(connector.importWork({ connectionId: 'c1', provider: 'linear' })).rejects.toThrow(
      /linear API POST \/graphql failed: 500/,
    );
  });

  it('reports mirror status sized from the issue nodes', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ data: { issues: { nodes: [{ id: 'a' }, { id: 'b' }] } } }), {
        status: 200,
      }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'linear' });
    expect(status).toEqual({ connectionId: 'c1', status: 'idle', itemCount: 2 });
  });

  it('resolves the canonical issue url from a workspace/identifier external id', async () => {
    const { http } = fakeHttp([]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const link = await connector.linkResource({
      connectionId: 'c1',
      provider: 'linear',
      resourceId: 'r1',
      externalId: 'docket/DOC-7',
    });
    expect(link.externalUrl).toBe('https://linear.app/docket/issue/DOC-7');
    const opaque = await connector.linkResource({
      connectionId: 'c1',
      provider: 'linear',
      resourceId: 'r2',
      externalId: 'opaque',
    });
    expect(opaque).not.toHaveProperty('externalUrl');
  });
});

describe('RealConnector — Google (Drive / Gmail / Calendar REST)', () => {
  it('Drive: resolves the account email, defaults the API base, and imports files', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ user: { emailAddress: 'me@x.dev' } }), { status: 200 }),
      new Response(
        JSON.stringify({
          files: [
            { id: 'f1', name: 'Q1 Doc', webViewLink: 'https://drive.google.com/file/d/f1' },
            { id: 'f2', name: 'No link' },
          ],
        }),
        { status: 200 },
      ),
    ]);
    const connector = new RealConnector({ provider: 'drive', accessToken: 'g_tok' }, http);
    const conn = await connector.connect({ provider: 'drive', referenceId: 'org_1' });
    expect(conn).toEqual({
      connectionId: 'drive:org_1',
      provider: 'drive',
      status: 'connected',
      account: 'me@x.dev',
    });
    expect(calls[0]!.url).toBe('https://www.googleapis.com/drive/v3/about?fields=user');
    expect(header(calls[0]!, 'Authorization')).toBe('Bearer g_tok');

    const items = await connector.importWork({ connectionId: 'c1', provider: 'drive' });
    expect(calls[1]!.url).toBe(
      'https://www.googleapis.com/drive/v3/files?fields=files(id,name,webViewLink)&pageSize=100',
    );
    expect(items[0]).toEqual({
      id: 'f1',
      kind: 'document',
      title: 'Q1 Doc',
      provenance: {
        provider: 'drive',
        externalId: 'f1',
        externalUrl: 'https://drive.google.com/file/d/f1',
        importedAt: items[0]!.provenance.importedAt,
      },
    });
    expect(items[1]?.provenance).not.toHaveProperty('externalUrl');
  });

  it('Drive: falls back to the displayName when emailAddress is absent', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ user: { displayName: 'Me' } }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'drive', accessToken: 'tok' }, http);
    expect((await connector.connect({ provider: 'drive', referenceId: 'o' })).account).toBe('Me');
  });

  it('Gmail: resolves the profile email and imports message threads', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ emailAddress: 'me@gmail.com' }), { status: 200 }),
      new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2' }] }), {
        status: 200,
      }),
    ]);
    const connector = new RealConnector({ provider: 'gmail', accessToken: 'tok' }, http);
    const conn = await connector.connect({ provider: 'gmail', referenceId: 'o' });
    expect(conn.account).toBe('me@gmail.com');
    expect(calls[0]!.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/profile');

    const items = await connector.importWork({ connectionId: 'c1', provider: 'gmail' });
    expect(calls[1]!.url).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100',
    );
    expect(items[0]).toMatchObject({
      id: 'm1',
      kind: 'message',
      provenance: { provider: 'gmail', externalId: 't1' },
    });
    // Falls back to the message id as the thread external id when threadId is absent.
    expect(items[1]?.provenance.externalId).toBe('m2');
  });

  it('Calendar: resolves the primary calendar id and imports events', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ id: 'me@x.dev' }), { status: 200 }),
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'e1',
              summary: 'Weekly planning',
              description: 'Monday sync',
              htmlLink: 'https://calendar.google.com/event?eid=e1',
            },
            { id: 'e2' },
          ],
        }),
        { status: 200 },
      ),
    ]);
    const connector = new RealConnector({ provider: 'calendar', accessToken: 'tok' }, http);
    const conn = await connector.connect({ provider: 'calendar', referenceId: 'o' });
    expect(conn.account).toBe('me@x.dev');
    expect(calls[0]!.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary');

    const items = await connector.importWork({ connectionId: 'c1', provider: 'calendar' });
    expect(calls[1]!.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=100',
    );
    expect(items[0]).toMatchObject({
      id: 'e1',
      kind: 'event',
      title: 'Weekly planning',
      body: 'Monday sync',
      provenance: { provider: 'calendar', externalId: 'e1' },
    });
    // Untitled event falls back to a placeholder title and omits body.
    expect(items[1]?.title).toBe('(no title)');
    expect(items[1]).not.toHaveProperty('body');
  });

  it('Calendar: falls back to the calendar summary when id is absent', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ summary: 'My Calendar' }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'calendar', accessToken: 'tok' }, http);
    expect((await connector.connect({ provider: 'calendar', referenceId: 'o' })).account).toBe(
      'My Calendar',
    );
  });

  it('Tasks: resolves the default-list account, defaults the API base, and imports open tasks', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ items: [{ id: 'list1', title: 'My Tasks' }] }), {
        status: 200,
      }),
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'gt1',
              title: 'Send the agreement',
              notes: 'To legal by Friday.',
              status: 'needsAction',
              webViewLink: 'https://tasks.google.com/task/gt1',
            },
            { id: 'gt2', status: 'needsAction' },
          ],
        }),
        { status: 200 },
      ),
    ]);
    const connector = new RealConnector({ provider: 'gtasks', accessToken: 'g_tok' }, http);
    const conn = await connector.connect({ provider: 'gtasks', referenceId: 'org_1' });
    expect(conn).toEqual({
      connectionId: 'gtasks:org_1',
      provider: 'gtasks',
      status: 'connected',
      account: 'My Tasks',
    });
    expect(calls[0]!.url).toBe(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1',
    );
    expect(header(calls[0]!, 'Authorization')).toBe('Bearer g_tok');

    const items = await connector.importWork({ connectionId: 'c1', provider: 'gtasks' });
    expect(calls[1]!.url).toBe(
      'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=100',
    );
    expect(items[0]).toEqual({
      id: 'gt1',
      kind: 'issue',
      title: 'Send the agreement',
      body: 'To legal by Friday.',
      provenance: {
        provider: 'gtasks',
        externalId: 'gt1',
        externalUrl: 'https://tasks.google.com/task/gt1',
        importedAt: items[0]!.provenance.importedAt,
      },
    });
    // An untitled task falls back to a placeholder and omits body + externalUrl.
    expect(items[1]?.title).toBe('(untitled task)');
    expect(items[1]).not.toHaveProperty('body');
    expect(items[1]?.provenance).not.toHaveProperty('externalUrl');
  });

  it('Tasks: falls back to the list id when the default list has no title, and resolves the task url', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ items: [{ id: 'list-only-id' }] }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'gtasks', accessToken: 'tok' }, http);
    expect((await connector.connect({ provider: 'gtasks', referenceId: 'o' })).account).toBe(
      'list-only-id',
    );
    const link = await connector.linkResource({
      connectionId: 'c1',
      provider: 'gtasks',
      resourceId: 'r1',
      externalId: 'gt1',
    });
    expect(link.externalUrl).toBe('https://tasks.google.com/task/gt1');
  });

  it('Tasks: tolerates an empty task list and reports a zero-sized mirror', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const connector = new RealConnector({ provider: 'gtasks', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'gtasks' });
    expect(status).toEqual({ connectionId: 'c1', status: 'idle', itemCount: 0 });
  });

  it('reports mirror status sized from the product listing', async () => {
    const { http } = fakeHttp([
      new Response(
        JSON.stringify({
          files: [
            { id: 'f1', name: 'a' },
            { id: 'f2', name: 'b' },
          ],
        }),
        {
          status: 200,
        },
      ),
    ]);
    const connector = new RealConnector({ provider: 'drive', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'drive' });
    expect(status).toEqual({ connectionId: 'c1', status: 'idle', itemCount: 2 });
  });

  it('resolves canonical product urls for link resolution', async () => {
    const { http } = fakeHttp([]);
    const drive = new RealConnector({ provider: 'drive', accessToken: 'tok' }, http);
    const gmail = new RealConnector({ provider: 'gmail', accessToken: 'tok' }, http);
    const calendar = new RealConnector({ provider: 'calendar', accessToken: 'tok' }, http);
    const base = { connectionId: 'c1', resourceId: 'r1' };
    expect(
      (await drive.linkResource({ ...base, provider: 'drive', externalId: 'f1' })).externalUrl,
    ).toBe('https://drive.google.com/file/d/f1');
    expect(
      (await gmail.linkResource({ ...base, provider: 'gmail', externalId: 't1' })).externalUrl,
    ).toBe('https://mail.google.com/mail/#all/t1');
    expect(
      (await calendar.linkResource({ ...base, provider: 'calendar', externalId: 'e1' }))
        .externalUrl,
    ).toBe('https://calendar.google.com/calendar/event?eid=e1');
  });
});
