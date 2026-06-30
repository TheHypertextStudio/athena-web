import { describe, expect, it } from 'vitest';

import { GoogleProviderClient } from '../../src/real/connector-google';
import type { ProviderHttp } from '../../src/real/connector-http';

/** One HTTP call the fake recorded, for assertions. */
interface RecordedCall {
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly body?: unknown;
}

/** A record-only ProviderHttp double — captures calls and returns a canned thread payload. */
class RecordingHttp {
  readonly calls: RecordedCall[] = [];
  threadJson: unknown = {};
  async getJson<T = unknown>(path: string): Promise<T> {
    this.calls.push({ method: 'get', path });
    return this.threadJson as T;
  }
  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'post', path, body });
    return {} as T;
  }
}

function gmailClient(http: RecordingHttp): GoogleProviderClient {
  return new GoogleProviderClient('gmail', http as unknown as ProviderHttp);
}

describe('GoogleProviderClient mail actions', () => {
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

  it('fetchThread parses headers + snippet into a render-ready MailThread', async () => {
    const http = new RecordingHttp();
    http.threadJson = {
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
            ],
          },
        },
      ],
    };
    const thread = await gmailClient(http).fetchThread({ connectionId: 'c', threadId: 't1' });
    expect(thread.threadId).toBe('t1');
    expect(thread.subject).toBe('Interview');
    expect(thread.externalUrl).toContain('t1');
    expect(thread.messages[0]).toMatchObject({
      from: 'Ada <ada@x.com>',
      to: ['you@x.com', 'two@x.com'],
      subject: 'Interview',
      snippet: 'hi there',
    });
  });

  it('throws for a non-gmail product', async () => {
    const http = new RecordingHttp();
    const drive = new GoogleProviderClient('drive', http as unknown as ProviderHttp);
    await expect(
      drive.applyMailAction({
        connectionId: 'c',
        provider: 'gmail',
        threadId: 't',
        action: { kind: 'archive' },
      }),
    ).rejects.toThrow();
  });
});
