import { describe, expect, it } from 'vitest';

import { MicrosoftProviderClient } from '../../src/microsoft';
import type { ConnectorProvider } from '../../src/connector';
import { ConnectorError } from '../../src/connector-error';
import type { ProviderHttp } from '../../src/provider-http';

// `ImportWorkInput`/`MirrorStatusInput.provider` is typed as the active `ConnectorProvider`
// union, which does not (yet) include Outlook — Microsoft is dormant/unwired in the real
// connector catalog (see the module remarks). The client itself never reads this field, so the
// cast mirrors the one `MicrosoftProviderClient.mirrorStatus` performs internally.
const OUTLOOK = 'outlook' as ConnectorProvider;

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

describe('MicrosoftProviderClient — base ConnectorProviderClient surface', () => {
  it('resolveAccount prefers mail, falls back to userPrincipalName, then undefined', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ mail: 'grace@example.com', userPrincipalName: 'grace@corp.local' });
    expect(await client(http).resolveAccount()).toEqual({ label: 'grace@example.com' });

    const http2 = new RecordingHttp();
    http2.respond = () => ({ userPrincipalName: 'grace@corp.local' });
    expect(await client(http2).resolveAccount()).toEqual({ label: 'grace@corp.local' });

    const http3 = new RecordingHttp();
    http3.respond = () => ({});
    expect(await client(http3).resolveAccount()).toBeUndefined();
  });

  it('importWork maps recent messages, falling back to a preview snippet or placeholder title', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({
      value: [
        graphMessage(),
        graphMessage({ id: 'msg-2', subject: undefined, bodyPreview: 'x'.repeat(120) }),
        graphMessage({
          id: 'msg-3',
          subject: undefined,
          bodyPreview: undefined,
          webLink: undefined,
        }),
      ],
    });
    const items = await client(http).importWork(
      { connectionId: 'c1', provider: OUTLOOK },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items[0]).toMatchObject({ id: 'msg-1', title: 'Send the signed NDA' });
    expect(items[1]?.title).toHaveLength(80);
    expect(items[2]?.title).toBe('Message msg-3');
    expect(items[2]?.provenance).not.toHaveProperty('externalUrl');
  });

  it('importWork tolerates a response with no value key', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    const items = await client(http).importWork(
      { connectionId: 'c1', provider: OUTLOOK },
      '2026-01-01T00:00:00.000Z',
    );
    expect(items).toEqual([]);
  });

  it('mirrorStatus sizes the mirror from the message-import count', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ value: [graphMessage(), graphMessage({ id: 'msg-2' })] });
    const status = await client(http).mirrorStatus({ connectionId: 'c1', provider: OUTLOOK });
    expect(status).toEqual({ connectionId: 'c1', status: 'idle', itemCount: 2 });
  });

  it('resolveExternalUrl always returns undefined (Graph deep links are not derivable from an id)', async () => {
    const http = new RecordingHttp();
    await expect(
      client(http).resolveExternalUrl({
        connectionId: 'c1',
        provider: OUTLOOK,
        resourceId: 'r1',
        externalId: 'msg-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('listContainers has no container concept and returns empty', async () => {
    const http = new RecordingHttp();
    await expect(client(http).listContainers()).resolves.toEqual([]);
  });
});

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

  it('falls back to blank fields for a thread summary with no subject/preview/link/messageId', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta")) {
        return {
          value: [
            {
              id: 'bare-1',
              conversationId: 'conv-bare',
              from: { emailAddress: { address: 'a@x.com' } },
            },
          ],
          '@odata.deltaLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=bare",
        };
      }
      throw new Error(`unexpected path ${path}`);
    };
    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 10 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads[0]).toEqual({
      threadId: 'conv-bare',
      subject: '',
      snippet: '',
      from: 'a@x.com',
      receivedAt: '',
      externalUrl: '',
    });
    expect(page.threads[0]).not.toHaveProperty('rfc822MessageId');
  });

  it('a 410 on a COLD pull (no cursor) still throws — there is no cursor to have expired', async () => {
    const http = new RecordingHttp();
    http.respond = () => {
      throw new ConnectorError('outlook API GET delta failed: 410', {
        provider: 'outlook',
        kind: 'provider',
        status: 410,
      });
    };
    await expect(client(http).listThreads({ connectionId: 'c', maxThreads: 10 })).rejects.toThrow();
  });

  it('skips deletion markers and messages without a conversationId, and keeps the earlier message when a later one is not newer', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta")) {
        return {
          value: [
            graphMessage({ id: 'deleted-1', '@removed': { reason: 'deleted' } }),
            graphMessage({ id: 'no-conv', conversationId: undefined }),
            graphMessage({
              id: 'msg-1',
              conversationId: 'conv-1',
              receivedDateTime: '2026-07-01T12:00:00Z',
            }),
            // Same conversation, but an OLDER receivedDateTime — must not replace msg-1.
            graphMessage({
              id: 'msg-0',
              conversationId: 'conv-1',
              receivedDateTime: '2026-07-01T09:00:00Z',
            }),
          ],
          '@odata.deltaLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=z",
        };
      }
      throw new Error(`unexpected path ${path}`);
    };
    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 50 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]?.threadId).toBe('conv-1');
    // The latest-known message (msg-1) won, not the older msg-0 that arrived after it in the page.
    expect(page.threads[0]?.receivedAt).toBe('2026-07-01T12:00:00Z');
  });

  it('treats a missing receivedDateTime as older than a dated message, and a dated one as newer than a missing one', async () => {
    const http = new RecordingHttp();
    http.respond = (path) => {
      if (path.startsWith("/me/mailFolders('inbox')/messages/delta")) {
        return {
          value: [
            // First message for conv-1 has no receivedDateTime at all — exercises the `?? ''`
            // fallback on the "prior" side of the comparison for the next message in the group.
            graphMessage({ id: 'msg-0', conversationId: 'conv-1', receivedDateTime: undefined }),
            graphMessage({
              id: 'msg-1',
              conversationId: 'conv-1',
              receivedDateTime: '2026-07-01T12:00:00Z',
            }),
            // First message for conv-2 is dated; the second has no receivedDateTime — exercises
            // the `?? ''` fallback on the "current message" side, which must not replace it.
            graphMessage({
              id: 'msg-2',
              conversationId: 'conv-2',
              receivedDateTime: '2026-07-01T12:00:00Z',
            }),
            graphMessage({ id: 'msg-3', conversationId: 'conv-2', receivedDateTime: undefined }),
          ],
          '@odata.deltaLink':
            "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=z",
        };
      }
      throw new Error(`unexpected path ${path}`);
    };
    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 50 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    const byConversation = new Map(page.threads.map((t) => [t.threadId, t]));
    // conv-1: the dated msg-1 replaced the undated msg-0.
    expect(byConversation.get('conv-1')?.receivedAt).toBe('2026-07-01T12:00:00Z');
    // conv-2: the undated msg-3 did NOT replace the dated msg-2.
    expect(byConversation.get('conv-2')?.receivedAt).toBe('2026-07-01T12:00:00Z');
  });

  it('resumes from the page itself (not an empty cursor) when a page has no links and no progress was made', async () => {
    const http = new RecordingHttp();
    // No `value` key at all — exercises the same `?? []` fallback as an empty array would.
    http.respond = () => ({});
    const page = await client(http).listThreads({ connectionId: 'c', maxThreads: 10 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.threads).toEqual([]);
    expect(page.nextCursor).toContain("/me/mailFolders('inbox')/messages/delta");
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

  it('markUnread PATCHes isRead: false', async () => {
    const http = new RecordingHttp();
    withConversation(http, [graphMessage()]);
    await client(http).applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'markUnread' },
    });
    expect(http.calls.find((x) => x.method === 'patch')?.body).toEqual({ isRead: false });
  });

  it('an empty conversation is a no-op fan-out (no messages to mutate)', async () => {
    const http = new RecordingHttp();
    withConversation(http, []);
    await expect(
      client(http).applyMailAction({
        connectionId: 'c',
        provider: 'outlook',
        threadId: 'conv-empty',
        action: { kind: 'archive' },
      }),
    ).resolves.toBeUndefined();
    expect(http.calls.filter((x) => x.method === 'post')).toHaveLength(0);
  });

  it('applyLabel treats a message with no categories key as starting empty', async () => {
    const http = new RecordingHttp();
    withConversation(http, [graphMessage({ categories: undefined })]);
    await client(http).applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'applyLabel', label: 'Docket' },
    });
    expect(http.calls.find((x) => x.method === 'patch')?.body).toEqual({
      categories: ['Docket'],
    });
  });

  it('conversationMessages tolerates a listing response with no value key', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    await expect(
      client(http).applyMailAction({
        connectionId: 'c',
        provider: 'outlook',
        threadId: 'conv-1',
        action: { kind: 'archive' },
      }),
    ).resolves.toBeUndefined();
    expect(http.calls.filter((x) => x.method === 'post')).toHaveLength(0);
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

  it('removeLabel drops a present category, and is a no-op when the category is already absent', async () => {
    const http = new RecordingHttp();
    withConversation(http, [graphMessage({ categories: ['Existing', 'Docket'] })]);
    const c = client(http);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'removeLabel', label: 'Docket' },
    });
    expect(http.calls.find((x) => x.method === 'patch')?.body).toEqual({
      categories: ['Existing'],
    });

    http.calls.length = 0;
    // No categories key at all — the `?? []` fallback, and nothing to remove.
    withConversation(http, [graphMessage({ categories: undefined })]);
    await c.applyMailAction({
      connectionId: 'c',
      provider: 'outlook',
      threadId: 'conv-1',
      action: { kind: 'removeLabel', label: 'Docket' },
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

  it('falls back to a placeholder subject and empty externalUrl for an empty conversation', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({ value: [] });
    const thread = await client(http).fetchThread({ connectionId: 'c', threadId: 'conv-empty' });
    expect(thread).toEqual({
      threadId: 'conv-empty',
      subject: 'Conversation conv-empty',
      messages: [],
      externalUrl: '',
    });
  });

  it('tolerates a response with no value key', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({});
    const thread = await client(http).fetchThread({ connectionId: 'c', threadId: 'conv-1' });
    expect(thread.messages).toEqual([]);
  });

  it('falls back to blank fields for a bare message with no subject/preview/date/messageId', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({
      value: [{ id: 'bare-1' }, { id: 'bare-2' }],
    });
    const thread = await client(http).fetchThread({ connectionId: 'c', threadId: 'conv-1' });
    // Both messages have no receivedDateTime — the sort comparator's `?? ''` fallback on both
    // sides keeps them in their original (stable) order.
    expect(thread.messages.map((m) => m.id)).toEqual(['bare-1', 'bare-2']);
    expect(thread.messages[0]).toMatchObject({
      from: '',
      to: [],
      subject: '',
      snippet: '',
      sentAt: '',
    });
    expect(thread.messages[0]).not.toHaveProperty('rfc822MessageId');
    expect(thread.messages[0]).not.toHaveProperty('inReplyTo');
    expect(thread.externalUrl).toBe('');
  });

  it('renders an address with only a name, only an address, or neither', async () => {
    const http = new RecordingHttp();
    http.respond = () => ({
      value: [
        graphMessage({
          id: 'name-only',
          from: { emailAddress: { name: 'Anon' } },
          toRecipients: [{ emailAddress: { address: 'only@x.com' } }],
        }),
        graphMessage({ id: 'neither', from: {}, toRecipients: [{ emailAddress: {} }] }),
        graphMessage({ id: 'no-from-object', from: undefined, toRecipients: undefined }),
      ],
    });
    const thread = await client(http).fetchThread({ connectionId: 'c', threadId: 'conv-1' });
    const byId = Object.fromEntries(thread.messages.map((m) => [m.id, m]));
    expect(byId['name-only']?.from).toBe('Anon');
    expect(byId['name-only']?.to).toEqual(['only@x.com']);
    expect(byId['neither']?.from).toBe('');
    expect(byId['no-from-object']?.from).toBe('');
    expect(byId['no-from-object']?.to).toEqual([]);
  });
});
