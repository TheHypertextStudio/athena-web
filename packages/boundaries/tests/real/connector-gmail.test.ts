import { describe, expect, it } from 'vitest';

import { GmailProviderClient } from '../../src/real/connector-gmail';
import { ConnectorError } from '../../src/ports/connector-error';
import type { ProviderHttp } from '../../src/real/connector-http';

/** One HTTP call the fake recorded, for assertions. */
interface RecordedCall {
  readonly method: 'get' | 'post';
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
    return {} as T;
  }
}

function gmailClient(http: RecordingHttp): GmailProviderClient {
  return new GmailProviderClient(http as unknown as ProviderHttp);
}

/** A canned metadata `threads.get` payload with full RFC 5322 headers. */
function threadJson(threadId: string, over: { from?: string; messageId?: string } = {}): unknown {
  return {
    id: threadId,
    messages: [
      {
        id: `${threadId}-m1`,
        snippet: 'hi there',
        internalDate: '1700000000000',
        payload: {
          headers: [
            { name: 'From', value: over.from ?? 'Ada <ada@x.com>' },
            { name: 'To', value: 'you@x.com' },
            { name: 'Subject', value: 'Interview' },
            { name: 'Message-ID', value: over.messageId ?? `<${threadId}-m1@x.com>` },
          ],
        },
      },
    ],
  };
}

describe('GmailProviderClient mail actions', () => {
  it('archive removes the INBOX label via threads/modify', async () => {
    const http = new RecordingHttp();
    await gmailClient(http).applyMailAction({
      connectionId: 'c',
      provider: 'gmail',
      threadId: 't1',
      action: { kind: 'archive' },
    });
    expect(http.calls).toEqual([
      { method: 'post', path: '/users/me/threads/t1/modify', body: { removeLabelIds: ['INBOX'] } },
    ]);
  });

  it('maps read/unread and label ops to the right deltas', async () => {
    const http = new RecordingHttp();
    const c = gmailClient(http);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'gmail',
      threadId: 't',
      action: { kind: 'markRead' },
    });
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'gmail',
      threadId: 't',
      action: { kind: 'markUnread' },
    });
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'gmail',
      threadId: 't',
      action: { kind: 'applyLabel', label: 'Label_1' },
    });
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'gmail',
      threadId: 't',
      action: { kind: 'removeLabel', label: 'Label_1' },
    });
    expect(http.calls.map((x) => x.body)).toEqual([
      { removeLabelIds: ['UNREAD'] },
      { addLabelIds: ['UNREAD'] },
      { addLabelIds: ['Label_1'] },
      { removeLabelIds: ['Label_1'] },
    ]);
  });

  it('trash posts to the thread trash endpoint', async () => {
    const http = new RecordingHttp();
    await gmailClient(http).applyMailAction({
      connectionId: 'c',
      provider: 'gmail',
      threadId: 't9',
      action: { kind: 'trash' },
    });
    expect(http.calls[0]?.path).toBe('/users/me/threads/t9/trash');
  });
});

describe('GmailProviderClient fetchThread', () => {
  it('requests RFC 5322 headers and parses them into a render-ready MailThread', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({
      id: 't1',
      messages: [
        {
          id: 'm1',
          snippet: 'hi there',
          internalDate: '1700000000000',
          payload: {
            headers: [
              { name: 'From', value: 'Ada <ada@x.com>' },
              { name: 'To', value: 'you@x.com, two@x.com' },
              { name: 'Subject', value: 'Interview' },
              { name: 'Message-ID', value: '<m1@x.com>' },
              { name: 'In-Reply-To', value: '<m0@x.com>' },
              { name: 'References', value: '<root@x.com>  <m0@x.com>' },
            ],
          },
        },
      ],
    });
    const thread = await gmailClient(http).fetchThread({ connectionId: 'c', threadId: 't1' });
    expect(http.calls[0]?.path).toContain('metadataHeaders=Message-ID');
    expect(http.calls[0]?.path).toContain('metadataHeaders=References');
    expect(thread.subject).toBe('Interview');
    expect(thread.messages[0]).toMatchObject({
      from: 'Ada <ada@x.com>',
      to: ['you@x.com', 'two@x.com'],
      rfc822MessageId: '<m1@x.com>',
      inReplyTo: '<m0@x.com>',
      references: ['<root@x.com>', '<m0@x.com>'],
    });
  });
});

describe('GmailProviderClient listThreads', () => {
  it('cold pull: lists threads, hydrates each with headers, and anchors the cursor to the profile historyId', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/me/threads?')) {
        return { threads: [{ id: 't1' }, { id: 't2' }] };
      }
      if (path.startsWith('/users/me/threads/t1')) return threadJson('t1');
      if (path.startsWith('/users/me/threads/t2')) {
        return threadJson('t2', { from: 'Deals <no-reply@shop.x.com>' });
      }
      if (path.startsWith('/users/me/profile')) return { historyId: 'h100' };
      throw new Error(`unexpected path ${path}`);
    };
    const page = await gmailClient(http).listThreads({ connectionId: 'c', maxThreads: 50 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.nextCursor).toBe('h100');
    expect(page.threads).toHaveLength(2);
    expect(page.threads[0]).toMatchObject({
      threadId: 't1',
      subject: 'Interview',
      from: 'Ada <ada@x.com>',
      rfc822MessageId: '<t1-m1@x.com>',
      externalUrl: 'https://mail.google.com/mail/#all/t1',
    });
    expect(page.threads[1]?.from).toBe('Deals <no-reply@shop.x.com>');
  });

  it('cold pull respects maxThreads across list pages', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/me/threads?')) {
        expect(path).toContain('maxResults=1');
        return { threads: [{ id: 't1' }], nextPageToken: 'p2' };
      }
      if (path.startsWith('/users/me/threads/t1')) return threadJson('t1');
      if (path.startsWith('/users/me/profile')) return { historyId: 'h1' };
      throw new Error(`unexpected path ${path}`);
    };
    const page = await gmailClient(http).listThreads({ connectionId: 'c', maxThreads: 1 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads).toHaveLength(1);
  });

  it('incremental pull: reads history since the cursor and returns the new historyId', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/me/history?')) {
        expect(path).toContain('startHistoryId=h100');
        expect(path).toContain('historyTypes=messageAdded');
        return {
          history: [
            { messagesAdded: [{ message: { threadId: 't3' } }] },
            { messagesAdded: [{ message: { threadId: 't3' } }, { message: { threadId: 't4' } }] },
          ],
          historyId: 'h200',
        };
      }
      if (path.startsWith('/users/me/threads/t3')) return threadJson('t3');
      if (path.startsWith('/users/me/threads/t4')) return threadJson('t4');
      throw new Error(`unexpected path ${path}`);
    };
    const page = await gmailClient(http).listThreads({
      connectionId: 'c',
      cursor: 'h100',
      maxThreads: 50,
    });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.nextCursor).toBe('h200');
    // t3 deduped across history records.
    expect(page.threads.map((t) => t.threadId)).toEqual(['t3', 't4']);
  });

  it('incremental pull: does not advance the cursor when maxThreads caps the walk before it drains', async () => {
    // Regression test: if the walk hits maxThreads while a history page is still pending
    // (nextPageToken present), the historyId from the partial page must NOT become the next
    // cursor — Gmail's historyId is the mailbox's *current* record, not a resumption token, so
    // persisting it here would permanently skip the un-fetched, older history.
    const http = new RecordingHttp();
    let historyCalls = 0;
    http.respond = (path) => {
      if (path.startsWith('/users/me/history?')) {
        historyCalls += 1;
        expect(path).toContain('startHistoryId=h100');
        return {
          history: [{ messagesAdded: [{ message: { threadId: 't1' } }] }],
          nextPageToken: 'p2',
          historyId: 'h150',
        };
      }
      if (path.startsWith('/users/me/threads/t1')) return threadJson('t1');
      throw new Error(`unexpected path ${path}`);
    };
    const page = await gmailClient(http).listThreads({
      connectionId: 'c',
      cursor: 'h100',
      maxThreads: 1,
    });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    // Capped after the first page — the second page (pageToken=p2) is never fetched.
    expect(historyCalls).toBe(1);
    expect(page.threads.map((t) => t.threadId)).toEqual(['t1']);
    expect(page.nextCursor).toBe('h100'); // unchanged, not the partial page's 'h150'
  });

  it('incremental pull: advances the cursor once a multi-page walk fully drains', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith('/users/me/history?')) {
        if (path.includes('pageToken=p2')) {
          return {
            history: [{ messagesAdded: [{ message: { threadId: 't2' } }] }],
            historyId: 'h200', // final page: no nextPageToken → fully drained
          };
        }
        return {
          history: [{ messagesAdded: [{ message: { threadId: 't1' } }] }],
          nextPageToken: 'p2',
          historyId: 'h150',
        };
      }
      if (path.startsWith('/users/me/threads/t1')) return threadJson('t1');
      if (path.startsWith('/users/me/threads/t2')) return threadJson('t2');
      throw new Error(`unexpected path ${path}`);
    };
    const page = await gmailClient(http).listThreads({
      connectionId: 'c',
      cursor: 'h100',
      maxThreads: 50, // high enough that the cap never truncates the walk
    });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads.map((t) => t.threadId)).toEqual(['t1', 't2']);
    expect(page.nextCursor).toBe('h200'); // the final (drained) page's historyId
  });

  it('a stale history cursor (404) surfaces as cursorExpired, not a throw', async () => {
    const http = new RecordingHttp();
    http.respond = () => {
      throw new ConnectorError('gmail API GET /users/me/history failed: 404', {
        provider: 'gmail',
        kind: 'provider',
        status: 404,
      });
    };
    const page = await gmailClient(http).listThreads({
      connectionId: 'c',
      cursor: 'ancient',
      maxThreads: 10,
    });
    expect(page).toEqual({ kind: 'cursorExpired' });
  });

  it('any other history failure still throws', async () => {
    const http = new RecordingHttp();
    http.respond = () => {
      throw new ConnectorError('gmail API GET /users/me/history failed: 500', {
        provider: 'gmail',
        kind: 'provider',
        status: 500,
      });
    };
    await expect(
      gmailClient(http).listThreads({ connectionId: 'c', cursor: 'h1', maxThreads: 10 }),
    ).rejects.toThrow();
  });
});
