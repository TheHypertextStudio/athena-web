import { describe, expect, it } from 'vitest';

import { MockConnector } from '../../src/mock/connector';

describe('MockConnector mail-actions capability', () => {
  it('exposes asMailActor for a mail provider and not for others', () => {
    expect(new MockConnector({ provider: 'gmail' }).asMailActor()).toBeDefined();
    expect(new MockConnector({ provider: 'github' }).asMailActor()).toBeUndefined();
    expect(new MockConnector({ provider: 'gtasks' }).asMailActor()).toBeUndefined();
  });

  it('records each applied action (record-only, no I/O) for test assertions', async () => {
    const mock = new MockConnector({ provider: 'gmail' });
    const mail = mock.asMailActor();
    if (!mail) throw new Error('expected a mail actor');

    await mail.applyMailAction({
      connectionId: 'conn_1',
      provider: 'gmail',
      threadId: 'thread_abc',
      action: { kind: 'archive' },
    });
    await mail.applyMailAction({
      connectionId: 'conn_1',
      provider: 'gmail',
      threadId: 'thread_abc',
      action: { kind: 'applyLabel', label: 'Docket' },
    });

    expect(mock.mailActionLog).toEqual([
      { threadId: 'thread_abc', action: { kind: 'archive' } },
      { threadId: 'thread_abc', action: { kind: 'applyLabel', label: 'Docket' } },
    ]);
  });

  it('fetchThread returns a deterministic render-ready thread', async () => {
    const mock = new MockConnector({ provider: 'gmail' });
    const mail = mock.asMailActor();
    if (!mail) throw new Error('expected a mail actor');

    const thread = await mail.fetchThread({ connectionId: 'conn_1', threadId: 'thread_abc' });
    expect(thread.threadId).toBe('thread_abc');
    expect(thread.messages.length).toBeGreaterThan(0);
    expect(thread.externalUrl).toContain('thread_abc');
    expect(thread.messages[0]?.from).toBeTruthy();
  });
});
