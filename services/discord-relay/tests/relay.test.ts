import { describe, expect, it, vi } from 'vitest';

import { type DiscordMessage } from '../src/expand';
import { buildEnvelope, forwardMessage } from '../src/relay';

const BASE = { ingestUrl: 'https://api.docket.test/internal/ingest/discord', ingestToken: 'tok_1' };

describe('buildEnvelope', () => {
  it('wraps a message as a MESSAGE_CREATE dispatch with the expanded mentions', () => {
    const msg: DiscordMessage = { id: 'M1', channel_id: 'C1' };
    expect(buildEnvelope(msg, ['U2'])).toEqual({
      t: 'MESSAGE_CREATE',
      d: msg,
      mentioned_user_ids: ['U2'],
    });
  });
});

describe('forwardMessage', () => {
  it('POSTs the envelope to the token edge and resolves true when accepted', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      mentions: [{ id: 'U2' }],
    };
    const ok = await forwardMessage(msg, {
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
      membersOfRole: () => [],
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://api.docket.test/internal/ingest/discord/tok_1');
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      t: 'MESSAGE_CREATE',
      d: msg,
      mentioned_user_ids: ['U2'],
    });
  });

  it('skips (false) and does not call fetch when nobody is mentioned', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    const msg: DiscordMessage = { id: 'M1', channel_id: 'C1', guild_id: 'G1', content: 'hi' };
    const ok = await forwardMessage(msg, {
      ...BASE,
      fetch: fetchMock as unknown as typeof fetch,
      membersOfRole: () => [],
    });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the ingest edge rejects the delivery', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 401 }),
    );
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      mentions: [{ id: 'U2' }],
    };
    await expect(
      forwardMessage(msg, {
        ...BASE,
        fetch: fetchMock as unknown as typeof fetch,
        membersOfRole: () => [],
      }),
    ).rejects.toThrow(/401/);
  });
});
