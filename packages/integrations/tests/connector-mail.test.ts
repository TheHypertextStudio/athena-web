import { describe, expect, it } from 'vitest';

import { MockConnector } from '../src/mock-connector';

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

describe('MockConnector listThreads', () => {
  it('serves the deterministic fixture summaries, bounded by maxThreads', async () => {
    const mail = new MockConnector({ provider: 'gmail' }).asMailActor();
    if (!mail) throw new Error('expected a mail actor');

    const page = await mail.listThreads({ connectionId: 'conn_1', maxThreads: 10 });
    expect(page.kind).toBe('page');
    if (page.kind !== 'page') return;
    expect(page.nextCursor).toBe('mock-cursor-1');
    expect(page.threads.map((t) => t.threadId)).toEqual([
      'gmail-thread-actionable',
      'gmail-thread-promo',
    ]);
    // The two fixtures exercise the funnel both ways: a person vs a no-reply promo sender.
    expect(page.threads[0]?.from).toContain('ada@example.com');
    expect(page.threads[1]?.from).toContain('no-reply@');
    expect(page.threads[0]?.rfc822MessageId).toBeDefined();

    const bounded = await mail.listThreads({ connectionId: 'conn_1', maxThreads: 1 });
    if (bounded.kind !== 'page') throw new Error('expected a page');
    expect(bounded.threads).toHaveLength(1);
  });

  it('reports cursorExpired for the sentinel cursor so the full-repull fallback is testable', async () => {
    const mail = new MockConnector({ provider: 'gmail' }).asMailActor();
    if (!mail) throw new Error('expected a mail actor');
    const page = await mail.listThreads({
      connectionId: 'conn_1',
      cursor: MockConnector.EXPIRED_CURSOR,
      maxThreads: 10,
    });
    expect(page).toEqual({ kind: 'cursorExpired' });
  });
});
