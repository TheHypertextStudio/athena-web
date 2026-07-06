import { describe, expect, it } from 'vitest';

import { MicrosoftProviderClient } from '../../src/real/connector-microsoft';
import { ConnectorError } from '../../src/ports/connector-error';
import type { ProviderHttp } from '../../src/real/connector-http';

/** One HTTP call the fake recorded, for assertions. */
interface RecordedCall {
  readonly method: 'get' | 'post' | 'patch';
  readonly path: string;
  readonly body?: unknown;
}

/** A record-only ProviderHttp double — captures calls and answers via a per-test router. */
class RecordingHttp {
  readonly calls: RecordedCall[] = [];
  respond: (path: string) => unknown = () => ({});
  async getJson<T = unknown>(path: string): Promise<T> {
    this.calls.push({ method: 'get', path });
    return this.respond(path) as T;
  }
  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'post', path, body });
    return {} as T;
  }
  async patchJson<T = unknown>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'patch', path, body });
    return {} as T;
  }
}

function client(http: RecordingHttp): MicrosoftProviderClient {
  return new MicrosoftProviderClient(http as unknown as ProviderHttp);
}

/** A canned Graph message for one conversation. */
function graphMessage(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    subject: 'Send the signed NDA',
    bodyPreview: 'Can you send it by Thursday?',
    webLink: 'https://outlook.office.com/mail/deeplink/msg-1',
    receivedDateTime: '2026-07-01T10:00:00Z',
    internetMessageId: '<nda-1@example.com>',
    from: { emailAddress: { name: 'Grace Hopper', address: 'grace@example.com' } },
    ...over,
  };
}

describe('MicrosoftProviderClient listThreads (delta protocol)', () => {
  it('cold pull walks the inbox delta, groups by conversation (latest wins), and stores the deltaLink', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta")) {
        return {
          value: [
            graphMessage(),
            graphMessage({
              id: 'msg-2',
              receivedDateTime: '2026-07-01T12:00:00Z',
              bodyPreview: 'Bumping this — Thursday still ok?',
            }),
            graphMessage({
              id: 'msg-3',
              conversationId: 'conv-2',
              subject: '40% off annual plans',
              from: { emailAddress: { name: 'Offers', address: 'no-reply@saas.example.com' } },
              internetMessageId: '<promo-1@saas.example.com>',
            }),
          ],
          '@odata.deltaLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=abc",
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 50 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.nextCursor).toContain('$deltatoken=abc');
    expect(page.threads).toHaveLength(2);
    // conv-1 collapsed to its LATEST message.
    expect(page.threads[0]).toMatchObject({
      threadId: 'conv-1',
      snippet: 'Bumping this — Thursday still ok?',
      from: 'Grace Hopper <grace@example.com>',
      rfc822MessageId: '<nda-1@example.com>',
    });
    expect(page.threads[1]?.from).toContain('no-reply@');
  });

  it('replays a stored deltaLink relative to the API base and follows nextLink pages', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta?$deltatoken=abc")) {
        return {
          value: [graphMessage({ id: 'msg-9', conversationId: 'conv-9' })],
          '@odata.nextLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$skiptoken=page2",
        };
      }
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta?$skiptoken=page2")) {
        return {
          value: [],
          '@odata.deltaLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=def",
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const page = await client(http).listThreads({
      connectionId: 'c',
      cursor:
        "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=abc",
      maxThreads: 50,
    });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads.map((t) => t.threadId)).toEqual(['conv-9']);
    expect(page.nextCursor).toContain('$deltatoken=def');
    // The absolute Graph links were replayed through the client relative to the API base.
    expect(http.calls.every((c) => c.path.startsWith('/me/'))).toBe(true);
  });

  it('a stale delta token (410 Gone) surfaces as cursorExpired, not a throw', async () => {
    const http = new RecordingHttp();
    http.respond = () => {
      throw new ConnectorError('outlook API GET delta failed: 410', {
        provider: 'outlook',
        kind: 'provider',
        status: 410,
      });
    };
    const page = await client(http).listThreads({
      connectionId: 'c',
      cursor: 'stale-delta-link',
      maxThreads: 10,
    });
    expect(page).toEqual({ kind: 'cursorExpired' });
  });

  it("bounds the walk itself by maxThreads: stops at the cap and resumes from that page's nextLink rather than draining to deltaLink and discarding the overflow", async () => {
    const http = new RecordingHttp();
    let page2Requested = false;
    http.respond = (path) => {
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta")) {
        return {
          value: [graphMessage({ id: 'msg-1', conversationId: 'conv-1' })],
          '@odata.nextLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$skiptoken=page2",
        };
      }
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta?$skiptoken=page2")) {
        page2Requested = true;
        return {
          value: [graphMessage({ id: 'msg-2', conversationId: 'conv-2' })],
          '@odata.deltaLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=def",
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 1 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    // Capped after the first page — conv-2 (on page 2) is never fetched, so it can't be
    // silently discarded by an end-of-walk truncation.
    expect(page2Requested).toBe(false);
    expect(page.threads.map((t) => t.threadId)).toEqual(['conv-1']);
    // Resumes from THIS page's nextLink, not a deltaLink that would claim conv-2 is consumed.
    expect(page.nextCursor).toContain('$skiptoken=page2');
  });

  it('resumes from the last nextLink (not an empty cursor) when MAX_DELTA_PAGES is exhausted before the walk drains', async () => {
    const http = new RecordingHttp();
    const totalPages = 10; // matches MAX_DELTA_PAGES
    http.respond = (path) => {
      const pageNum = path.includes('$skiptoken=p')
        ? Number(/skiptoken=p(\d+)/.exec(path)?.[1])
        : 0;
      const next = pageNum + 1;
      return {
        value: [
          graphMessage({ id: `msg-${String(pageNum)}`, conversationId: `conv-${String(pageNum)}` }),
        ],
        // Every page (including the last) hands back a nextLink — the backlog exceeds the
        // page budget, so the walk never reaches a natural deltaLink.
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$skiptoken=p${String(next)}`,
      };
    };

    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 1000 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads).toHaveLength(totalPages);
    // Never an empty cursor: the next sweep continues from the last page's nextLink instead of
    // restarting the whole backlog walk from scratch every time.
    expect(page.nextCursor).not.toBe('');
    expect(page.nextCursor).toContain(`$skiptoken=p${String(totalPages)}`);
  });
});

describe('MicrosoftProviderClient mail actions (thread → message fan-out)', () => {
  /** Route the conversation listing, then record the per-message mutations. */
  function withConversation(http: RecordingHttp, messages: Record<string, unknown>[]): void {
    http.respond = (path) => {
      if (path.startsWith('/me/messages?$filter=conversationId')) return { value: messages };
      throw new Error(`unexpected path ${path}`);
    };
  }

  it('archive moves every message of the conversation to the archive folder', async () => {
    const http = new RecordingHttp();
    withConversation(http, [graphMessage(), graphMessage({ id: 'msg-2' })]);
    await client(http).applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'archive' },
    });
    const moves = http.calls.filter((c) => c.method === 'post');
    expect(moves).toEqual([
      { method: 'post', path: '/me/messages/msg-1/move', body: { destinationId: 'archive' } },
      { method: 'post', path: '/me/messages/msg-2/move', body: { destinationId: 'archive' } },
    ]);
  });

  it('trash moves to deleteditems; read state PATCHes isRead', async () => {
    const http = new RecordingHttp();
    withConversation(http, [graphMessage()]);
    const c = client(http);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'trash' },
    });
    withConversation(http, [graphMessage()]);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'markRead' },
    });
    expect(http.calls.find((x) => x.method === 'post')?.body).toEqual({
      destinationId: 'deleteditems',
    });
    expect(http.calls.find((x) => x.method === 'patch')?.body).toEqual({ isRead: true });
  });

  it('labels are a duplicate-free read-modify-write of categories', async () => {
    const http = new RecordingHttp();
    withConversation(http, [graphMessage({ categories: ['Existing'] })]);
    const c = client(http);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'applyLabel', label: 'Docket' },
    });
    expect(http.calls.find((x) => x.method === 'patch')?.body).toEqual({
      categories: ['Existing', 'Docket'],
    });

    // Already present: no write at all.
    http.calls.length = 0;
    withConversation(http, [graphMessage({ categories: ['Docket'] })]);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'applyLabel', label: 'Docket' },
    });
    expect(http.calls.filter((x) => x.method === 'patch')).toHaveLength(0);
  });
});

describe('MicrosoftProviderClient fetchThread', () => {
  it('sorts by receipt time and maps RFC 5322 headers from internetMessageHeaders', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({
      value: [
        graphMessage({
          id: 'msg-2',
          receivedDateTime: '2026-07-01T12:00:00Z',
          internetMessageId: '<reply-1@example.com>',
          toRecipients: [{ emailAddress: { name: 'Ada', address: 'ada@example.com' } }],
          internetMessageHeaders: [
            { name: 'In-Reply-To', value: '<nda-1@example.com>' },
            { name: 'References', value: '<root@example.com> <nda-1@example.com>' },
          ],
        }),
        graphMessage(),
      ],
    });
    const thread = await client(http).fetchThread({ connectionId: 'c', threadId: 'conv-1' });
    expect(thread.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2']); // oldest first
    expect(thread.messages[1]).toMatchObject({
      rfc822MessageId: '<reply-1@example.com>',
      inReplyTo: '<nda-1@example.com>',
      references: ['<root@example.com>', '<nda-1@example.com>'],
      to: ['Ada <ada@example.com>'],
    });
    expect(thread.externalUrl).toContain('outlook.office.com');
  });
});
