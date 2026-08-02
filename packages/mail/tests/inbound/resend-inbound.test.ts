/**
 * The two inbound adapters, driven through the port. The real one is exercised with a fake HTTP
 * client so the two-step Resend flow (signed metadata webhook, then a body read) is observable
 * without an account; the fixture one is exercised on the same payloads to prove the offline path
 * is the production parser rather than a lookalike.
 */
import { describe, expect, it } from 'vitest';

import { FixtureInboundReceiver, buildInboundFixturePayload } from '../../src/fixture-inbound';
import { buildInboundReceiverFromEnv } from '../../src/inbound-transport';
import { htmlToText, mailboxKeyOf, parseAddress, snippetOf } from '../../src/inbound';
import {
  RESEND_RECEIVING_ENDPOINT,
  ResendInboundReceiver,
  readResendInboundPayload,
} from '../../src/resend-inbound';
import { signSvixPayload } from '../../src/svix-signature';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const NOW = new Date(1_700_000_000_000);

/** Sign a body the way the provider would, so the adapter's own verification runs for real. */
function signedHeaders(payload: string): Record<string, string> {
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  return {
    'svix-id': 'msg_1',
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signSvixPayload(SECRET, 'msg_1', timestamp, payload)}`,
  };
}

const WEBHOOK = buildInboundFixturePayload({
  emailId: 'e_9001',
  from: 'Jane Rivera <jane@example.com>',
  to: ['k7x9qm2b4r8t@inbox.athena.example'],
  subject: 'Contract for the Q3 refresh',
  messageId: '<abc@example.com>',
  receivedAt: '2026-08-02T09:15:00.000Z',
  attachments: [{ id: 'att_1', filename: 'contract.pdf', contentType: 'application/pdf' }],
});

describe('readResendInboundPayload', () => {
  it('reads a received-email webhook into a normalized notification', () => {
    const read = readResendInboundPayload(WEBHOOK);
    expect(read.kind).toBe('inbound');
    if (read.kind !== 'inbound') return;
    expect(read.notification.emailId).toBe('e_9001');
    expect(read.notification.subject).toBe('Contract for the Q3 refresh');
    expect(read.notification.messageId).toBe('<abc@example.com>');
    expect(read.notification.attachments).toEqual([
      {
        id: 'att_1',
        filename: 'contract.pdf',
        contentType: 'application/pdf',
        contentDisposition: 'attachment',
        contentId: null,
      },
    ]);
  });

  it('reports an authentic event of another type as other, not malformed', () => {
    expect(readResendInboundPayload(JSON.stringify({ type: 'email.delivered', data: {} }))).toEqual(
      {
        kind: 'other',
        eventType: 'email.delivered',
      },
    );
  });

  it('reports unreadable or incomplete bodies as malformed', () => {
    for (const body of [
      'not json',
      '[]',
      '{}',
      JSON.stringify({ type: 'email.received' }),
      JSON.stringify({ type: 'email.received', data: { from: 'a@b.c' } }),
      JSON.stringify({ type: 'email.received', data: { email_id: 'x' } }),
    ]) {
      expect(readResendInboundPayload(body)).toEqual({ kind: 'malformed' });
    }
  });

  it('tolerates unknown extra fields rather than failing on them', () => {
    const body = JSON.stringify({
      type: 'email.received',
      created_at: '2026-08-02T09:15:00.000Z',
      something_new: { nested: true },
      data: { email_id: 'e1', from: 'a@b.c', to: 'solo@inbox.example', unknown: 1 },
    });
    const read = readResendInboundPayload(body);
    expect(read.kind).toBe('inbound');
    if (read.kind !== 'inbound') return;
    // A single bare string recipient is accepted as a one-element list.
    expect(read.notification.to).toEqual(['solo@inbox.example']);
  });
});

describe('ResendInboundReceiver', () => {
  it('verifies the signature, then fetches the body from the receiving API', async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    const receiver = new ResendInboundReceiver(
      { signingSecret: SECRET, apiKey: 're_key' },
      (url, init) => {
        calls.push({
          url,
          auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'],
        });
        return Promise.resolve(
          new Response(JSON.stringify({ text: 'Signed and returned.', html: '<p>Signed.</p>' }), {
            status: 200,
          }),
        );
      },
    );

    const result = await receiver.receive({
      rawBody: WEBHOOK,
      headers: signedHeaders(WEBHOOK),
      now: NOW,
    });

    expect(calls).toEqual([{ url: `${RESEND_RECEIVING_ENDPOINT}/e_9001`, auth: 'Bearer re_key' }]);
    expect(result.status).toBe('received');
    if (result.status !== 'received') return;
    expect(result.message).toMatchObject({
      providerMessageId: 'e_9001',
      rfc822MessageId: '<abc@example.com>',
      fromAddress: 'jane@example.com',
      fromName: 'Jane Rivera',
      subject: 'Contract for the Q3 refresh',
      text: 'Signed and returned.',
      bodyStatus: 'complete',
      receivedAt: '2026-08-02T09:15:00.000Z',
    });
    expect(result.message.to).toEqual(['k7x9qm2b4r8t@inbox.athena.example']);
  });

  it('keeps the message when the body read fails, and says the body is missing', async () => {
    for (const respond of [
      () => Promise.resolve(new Response('nope', { status: 500 })),
      () => Promise.reject(new Error('socket hang up')),
      () => Promise.resolve(new Response('not json', { status: 200 })),
    ]) {
      const receiver = new ResendInboundReceiver(
        { signingSecret: SECRET, apiKey: 're_key' },
        respond,
      );
      const result = await receiver.receive({
        rawBody: WEBHOOK,
        headers: signedHeaders(WEBHOOK),
        now: NOW,
      });
      expect(result.status).toBe('received');
      if (result.status !== 'received') return;
      expect(result.message.bodyStatus).toBe('metadata-only');
      expect(result.message.text).toBeNull();
      expect(result.message.subject).toBe('Contract for the Q3 refresh');
    }
  });

  it('reads a body returned inside a data envelope', async () => {
    const receiver = new ResendInboundReceiver({ signingSecret: SECRET, apiKey: 're_key' }, () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { text: 'Wrapped.' } }), { status: 200 }),
      ),
    );
    const result = await receiver.receive({
      rawBody: WEBHOOK,
      headers: signedHeaders(WEBHOOK),
      now: NOW,
    });
    expect(result.status === 'received' && result.message.text).toBe('Wrapped.');
  });

  it('derives readable text when the message has only an HTML part', async () => {
    const receiver = new ResendInboundReceiver({ signingSecret: SECRET, apiKey: 're_key' }, () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ html: '<style>p{}</style><p>Hi&nbsp;there</p><p>Second&amp;last</p>' }),
          { status: 200 },
        ),
      ),
    );
    const result = await receiver.receive({
      rawBody: WEBHOOK,
      headers: signedHeaders(WEBHOOK),
      now: NOW,
    });
    expect(result.status === 'received' && result.message.text).toBe('Hi there\nSecond&last');
  });

  it('refuses an unsigned request without ever calling the provider', async () => {
    let called = false;
    const receiver = new ResendInboundReceiver({ signingSecret: SECRET, apiKey: 're_key' }, () => {
      called = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const result = await receiver.receive({ rawBody: WEBHOOK, headers: {}, now: NOW });
    expect(result).toEqual({ status: 'rejected', code: 'missing-signature' });
    expect(called).toBe(false);
  });

  it('refuses a body that was altered after it was signed', async () => {
    const receiver = new ResendInboundReceiver({ signingSecret: SECRET, apiKey: 're_key' }, () =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const result = await receiver.receive({
      rawBody: WEBHOOK.replace('Jane Rivera', 'Mallory'),
      headers: signedHeaders(WEBHOOK),
      now: NOW,
    });
    expect(result).toEqual({ status: 'rejected', code: 'invalid-signature' });
  });

  it('acknowledges an authentic event about something else without delivering it', async () => {
    const other = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
    const receiver = new ResendInboundReceiver({ signingSecret: SECRET, apiKey: 're_key' }, () =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const result = await receiver.receive({
      rawBody: other,
      headers: signedHeaders(other),
      now: NOW,
    });
    expect(result).toEqual({ status: 'ignored', eventType: 'email.delivered' });
  });
});

describe('FixtureInboundReceiver', () => {
  it('reads the same payload shape offline, with the body inline', async () => {
    const payload = buildInboundFixturePayload({
      emailId: 'e_1',
      from: 'ops@example.com',
      to: ['abc123@inbox.athena.example'],
      subject: 'Weekly numbers',
      text: 'Revenue is up.',
    });
    const result = await new FixtureInboundReceiver().receive({ rawBody: payload, headers: {} });
    expect(result.status).toBe('received');
    if (result.status !== 'received') return;
    expect(result.message).toMatchObject({
      providerMessageId: 'e_1',
      fromAddress: 'ops@example.com',
      fromName: null,
      text: 'Revenue is up.',
      bodyStatus: 'complete',
    });
  });

  it('serves a registered fixture body when the payload carries none', async () => {
    const payload = buildInboundFixturePayload({
      emailId: 'e_2',
      from: 'ops@example.com',
      to: ['abc123@inbox.athena.example'],
      subject: 'No inline body',
    });
    const receiver = new FixtureInboundReceiver({
      bodies: { e_2: { text: 'From the fixture.', html: null } },
    });
    const result = await receiver.receive({ rawBody: payload, headers: {} });
    expect(result.status === 'received' && result.message.text).toBe('From the fixture.');
  });

  it('verifies signatures with the real algorithm when a secret is configured', async () => {
    const receiver = new FixtureInboundReceiver({ signingSecret: SECRET });
    expect(await receiver.receive({ rawBody: WEBHOOK, headers: {}, now: NOW })).toEqual({
      status: 'rejected',
      code: 'missing-signature',
    });
    expect(
      (await receiver.receive({ rawBody: WEBHOOK, headers: signedHeaders(WEBHOOK), now: NOW }))
        .status,
    ).toBe('received');
  });
});

describe('buildInboundReceiverFromEnv', () => {
  it('uses the offline receiver in local and test', () => {
    for (const mode of ['local', 'test'] as const) {
      expect(buildInboundReceiverFromEnv({ APP_MODE: mode }).providerId).toBe('fixture');
    }
  });

  it('uses Resend in production when both credentials are present', () => {
    const receiver = buildInboundReceiverFromEnv({
      APP_MODE: 'production',
      RESEND_API_KEY: 're_live',
      RESEND_INBOUND_WEBHOOK_SECRET: SECRET,
    });
    expect(receiver.providerId).toBe('resend');
  });

  it('refuses to build a production receiver without a signing secret', () => {
    expect(() =>
      buildInboundReceiverFromEnv({ APP_MODE: 'production', RESEND_API_KEY: 're_live' }),
    ).toThrow(/RESEND_INBOUND_WEBHOOK_SECRET/);
    expect(() =>
      buildInboundReceiverFromEnv({
        APP_MODE: 'production',
        RESEND_INBOUND_WEBHOOK_SECRET: SECRET,
      }),
    ).toThrow(/RESEND_API_KEY/);
  });
});

describe('address helpers', () => {
  it('splits both address header forms', () => {
    expect(parseAddress('Jane Rivera <Jane@Example.com>')).toEqual({
      name: 'Jane Rivera',
      address: 'jane@example.com',
    });
    expect(parseAddress('"Rivera, Jane" <jane@example.com>')).toEqual({
      name: 'Rivera, Jane',
      address: 'jane@example.com',
    });
    expect(parseAddress('  BARE@Example.com ')).toEqual({
      name: null,
      address: 'bare@example.com',
    });
  });

  it('routes a plus-addressed variant to the same mailbox', () => {
    expect(mailboxKeyOf('k7x9@inbox.example')).toBe('k7x9');
    expect(mailboxKeyOf('K7X9+newsletters@inbox.example')).toBe('k7x9');
  });

  it('refuses to guess at a malformed address', () => {
    for (const bad of ['nope', '@host', 'a@b@c', '']) {
      expect(mailboxKeyOf(bad)).toBeNull();
    }
  });

  it('previews a body without cutting a word in half', () => {
    expect(snippetOf(null)).toBeNull();
    expect(snippetOf('   \n  ')).toBeNull();
    expect(snippetOf('one   two\n three')).toBe('one two three');
    const long = `${'word '.repeat(60)}end`;
    const preview = snippetOf(long, 40);
    expect(preview?.endsWith('…')).toBe(true);
    expect(preview?.length).toBeLessThanOrEqual(41);
  });

  it('flattens HTML into something a person can read', () => {
    expect(htmlToText('<div>Line<br>Break</div><script>x()</script>')).toBe('Line\nBreak');
  });
});
