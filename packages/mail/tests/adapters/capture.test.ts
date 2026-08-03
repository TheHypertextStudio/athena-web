/**
 * The two offline `Mailer` adapters: `CaptureMailer` (asserted against in tests) and
 * `ConsoleMailer` (dev-only logging). Both are simple, but `outbox`/`last()` ordering and the
 * per-mailer id counter are real behavior other packages depend on for deterministic assertions.
 */
import { describe, expect, it, vi } from 'vitest';

import { CaptureMailer, ConsoleMailer } from '../../src/capture';

describe('CaptureMailer', () => {
  it('starts with an empty outbox and no last message', () => {
    const mailer = new CaptureMailer();
    expect(mailer.outbox).toEqual([]);
    expect(mailer.last()).toBeUndefined();
  });

  it('captures a sent message with a stable zero-padded id and the fixed default now', async () => {
    const mailer = new CaptureMailer();
    await mailer.send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });
    expect(mailer.outbox).toEqual([
      {
        to: 'a@b.com',
        subject: 'Hi',
        text: 'hello',
        id: 'msg_000001',
        sentAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(mailer.last()).toEqual(mailer.outbox[0]);
  });

  it('increments the id counter across sends and honors a configured now', async () => {
    const mailer = new CaptureMailer({ now: '2026-03-14T00:00:00.000Z' });
    await mailer.send({ to: 'a@b.com', subject: 'One', text: '1' });
    await mailer.send({ to: 'b@b.com', subject: 'Two', text: '2' });
    expect(mailer.outbox.map((m) => m.id)).toEqual(['msg_000001', 'msg_000002']);
    expect(mailer.outbox.every((m) => m.sentAt === '2026-03-14T00:00:00.000Z')).toBe(true);
    expect(mailer.last()?.subject).toBe('Two');
  });
});

describe('ConsoleMailer', () => {
  it('logs the recipient and subject instead of sending', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const mailer = new ConsoleMailer();
      await expect(
        mailer.send({ to: 'person@example.com', subject: 'Welcome', text: 'hi' }),
      ).resolves.toBeUndefined();
      expect(info).toHaveBeenCalledWith('[ConsoleMailer] to=person@example.com subject=Welcome');
    } finally {
      info.mockRestore();
    }
  });
});
