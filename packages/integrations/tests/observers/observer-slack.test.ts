import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealSlackObserver } from '../../src/observer-slack';
import { slackMentionedUserIds } from '../../src';

const SECRET = 'slack_signing_secret_test';
const RECEIVED_AT = '2026-06-28T12:00:00.000Z';

const observer = new RealSlackObserver({ signingSecret: SECRET });

describe('public Slack helpers', () => {
  it('exports the canonical mention parser from the package barrel', () => {
    expect(slackMentionedUserIds('hi <@U1> and <@U1> <@W2|wanda>')).toEqual(['U1', 'W2']);
  });
});

/** Sign a body exactly as Slack does: `v0=` + hex HMAC over `v0:<ts>:<body>`. */
function sign(body: string, ts: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${body}`, 'utf8').digest('hex')}`;
}

function recentTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('RealSlackObserver.verifySignature', () => {
  it('accepts a valid v0 signature within the replay window', () => {
    const body = JSON.stringify({ type: 'event_callback' });
    const ts = recentTs();
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts },
      }),
    ).toBe(true);
  });

  it('rejects a stale timestamp (replay guard)', () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000) - 1000);
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: { 'x-slack-signature': sign(body, ts), 'x-slack-request-timestamp': ts },
      }),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const body = '{"a":1}';
    const ts = recentTs();
    const sig = sign(body, ts);
    expect(
      observer.verifySignature({
        rawBody: `${body} `,
        headers: { 'x-slack-signature': sig, 'x-slack-request-timestamp': ts },
      }),
    ).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(observer.verifySignature({ rawBody: '{}', headers: {} })).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const body = '{}';
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: {
          'x-slack-signature': sign(body, 'not-a-number'),
          'x-slack-request-timestamp': 'not-a-number',
        },
      }),
    ).toBe(false);
  });

  it('rejects a signature of the wrong byte length outright', () => {
    const ts = recentTs();
    expect(
      observer.verifySignature({
        rawBody: '{}',
        headers: { 'x-slack-signature': 'v0=short', 'x-slack-request-timestamp': ts },
      }),
    ).toBe(false);
  });
});

describe('RealSlackObserver.route', () => {
  it('routes by team_id with the inner event type + event id', () => {
    const r = observer.route({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev1',
      event: { type: 'app_mention' },
    });
    expect(r?.externalWorkspaceId).toBe('T1');
    expect(r?.externalEventId).toBe('Ev1');
    expect(r?.eventType).toBe('app_mention');
  });

  it('returns null for the url_verification handshake', () => {
    expect(observer.route({ type: 'url_verification', challenge: 'c' })).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(observer.route('not-json')).toBeNull();
  });
});

describe('RealSlackObserver.normalize', () => {
  it('maps an app_mention to a mention event (thread entity + actor + slack.message detail)', () => {
    const payload = {
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev1',
      event: {
        type: 'app_mention',
        user: 'U9',
        channel: 'C5',
        text: 'hey @docket',
        thread_ts: '1699999999.000050',
        ts: '1700000000.000100',
      },
    };
    const [obs] = observer.normalize({
      eventType: 'app_mention',
      payload,
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('mention');
    expect(obs?.summary).toBe('hey @docket');
    expect(obs?.actor?.externalId).toBe('U9');
    expect(obs?.entity).toEqual({ kind: 'thread', externalId: 'C5' });
    expect(obs?.detail).toEqual({
      schema: 'slack.message',
      channelId: 'C5',
      threadTs: '1699999999.000050',
      text: 'hey @docket',
      channelType: null,
    });
  });

  it('extracts <@U…> user mentions (incl. label form) into participants, deduplicated', () => {
    const drafts = observer.normalize({
      eventType: 'message',
      payload: {
        team_id: 'T1',
        event_id: 'Ev2',
        event: {
          type: 'message',
          user: 'U1',
          channel: 'C5',
          channel_type: 'channel',
          text: 'ping <@U2> and <@W3|wanda> — also <@U2> again',
          ts: '1700000000.000100',
        },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.participants?.map((p) => p.externalId)).toEqual(['U2', 'W3']);
    expect(drafts[0]?.detail).toMatchObject({ schema: 'slack.message', channelType: 'channel' });
  });

  it('emits no participants when the text has no user mentions', () => {
    const [obs] = observer.normalize({
      eventType: 'message',
      payload: {
        event: { type: 'message', user: 'U1', channel: 'C5', text: 'no mentions here' },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.participants ?? []).toEqual([]);
  });

  it('titles a direct message by its channel_type and carries it on the detail', () => {
    const [obs] = observer.normalize({
      eventType: 'message',
      payload: {
        event: {
          type: 'message',
          user: 'U1',
          channel: 'D8',
          channel_type: 'im',
          text: 'psst',
          ts: '1700000000.000100',
        },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.title).toBe('Slack direct message');
    expect(obs?.detail).toMatchObject({ schema: 'slack.message', channelType: 'im' });
  });

  it.each([
    'message_changed',
    'message_deleted',
    'channel_join',
    'channel_leave',
    'channel_topic',
    'bot_message',
  ])('skips the noisy %s subtype entirely', (subtype) => {
    expect(
      observer.normalize({
        eventType: 'message',
        payload: { event: { type: 'message', subtype, user: 'U1', channel: 'C5', text: 'x' } },
        receivedAt: RECEIVED_AT,
      }),
    ).toEqual([]);
  });

  it('skips bot-authored messages (bot_id present)', () => {
    expect(
      observer.normalize({
        eventType: 'message',
        payload: {
          event: { type: 'message', bot_id: 'B7', channel: 'C5', text: 'beep', ts: '1.2' },
        },
        receivedAt: RECEIVED_AT,
      }),
    ).toEqual([]);
  });

  it('still records a thread_broadcast reply (not a skipped subtype)', () => {
    const drafts = observer.normalize({
      eventType: 'message',
      payload: {
        event: {
          type: 'message',
          subtype: 'thread_broadcast',
          user: 'U1',
          channel: 'C5',
          text: 'fyi',
          thread_ts: '1699999999.000050',
          ts: '1700000000.000100',
        },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.detail).toMatchObject({ threadTs: '1699999999.000050' });
  });

  it('maps an unhandled event type to a degraded message-kind generic draft', () => {
    const drafts = observer.normalize({
      eventType: 'channel_created',
      payload: { event: { type: 'channel_created' } },
      receivedAt: RECEIVED_AT,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe('message');
    expect(drafts[0]?.detail?.schema).toBe('generic');
  });

  it('returns [] for a handshake payload with no inner event', () => {
    expect(
      observer.normalize({
        eventType: 'url_verification',
        payload: { type: 'url_verification', challenge: 'c' },
        receivedAt: RECEIVED_AT,
      }),
    ).toEqual([]);
  });

  it('maps a reaction_added event to a reaction-kind draft', () => {
    const [obs] = observer.normalize({
      eventType: 'reaction_added',
      payload: {
        event: { type: 'reaction_added', user: 'U1', channel: 'C5', reaction: 'thumbsup' },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.kind).toBe('reaction');
    expect(obs?.title).toBe('New Slack reaction');
  });

  it('falls back to a generic detail when a message/app_mention event carries no channel', () => {
    const [obs] = observer.normalize({
      eventType: 'message',
      payload: { event: { type: 'message', user: 'U1', text: 'no channel here' } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.entity).toBeUndefined();
    expect(obs?.detail?.schema).toBe('generic');
  });

  it('titles a group (mpim) message and carries the channel type on the detail', () => {
    const [obs] = observer.normalize({
      eventType: 'message',
      payload: {
        event: { type: 'message', user: 'U1', channel: 'G1', channel_type: 'mpim', text: 'hey' },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.title).toBe('Slack group message');
    expect(obs?.detail).toMatchObject({ channelType: 'mpim' });
  });

  it('titles an unmapped event with no inner type as "Slack event: unknown"', () => {
    const [obs] = observer.normalize({
      eventType: 'unknown',
      payload: { event: { user: 'U1', channel: 'C5' } },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.title).toBe('Slack event: unknown');
  });

  it('falls back occurredAt to receivedAt when the event ts is not a valid number', () => {
    const [obs] = observer.normalize({
      eventType: 'message',
      payload: {
        event: { type: 'message', user: 'U1', channel: 'C5', text: 'hi', ts: 'not-a-number' },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(obs?.occurredAt).toBe(RECEIVED_AT);
  });
});
