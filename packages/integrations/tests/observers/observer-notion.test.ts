import { signWebhookPayload } from '@notionhq/client';
import { describe, expect, it } from 'vitest';

import {
  NOTION_VERIFICATION_EVENT,
  RealNotionObserver,
  isSelfAuthored,
  readVerificationToken,
} from '../../src/observer-notion';

// Deliberately not shaped like a real credential. The value only has to be a stable HMAC key, and
// anything resembling `secret_<base62>` trips the repository's secret scan — correctly, since a
// scanner cannot tell a docs example from a live token.
const TOKEN = 'notion-webhook-token-for-tests';
const observer = new RealNotionObserver({ verificationToken: TOKEN });

/** A realistic delivery, shaped as `BaseWebhookPayload` types it. */
function delivery(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt_1',
    timestamp: '2026-08-08T00:00:00.000Z',
    workspace_id: 'ws_1',
    workspace_name: 'Las Vegans for Better Transit',
    subscription_id: 'sub_1',
    integration_id: 'int_1',
    authors: [{ id: 'person_1', type: 'person' }],
    attempt_number: 1,
    api_version: '2025-09-03',
    type: 'page.properties_updated',
    entity: { type: 'page', id: 'page_1' },
    ...over,
  };
}

describe('signature verification', () => {
  it('accepts a body signed by the SDK itself', async () => {
    // The load-bearing assertion of this file. The port is synchronous and the SDK's helper is
    // async, so this implements the HMAC with node:crypto — but "the SDK is the source of truth"
    // has to mean something checkable, so the fixture is signed by the SDK's own signer. An SDK
    // change to the scheme fails here rather than silently rejecting live traffic.
    const rawBody = JSON.stringify(delivery());
    const signature = await signWebhookPayload({ body: rawBody, verificationToken: TOKEN });
    expect(
      observer.verifySignature({ rawBody, headers: { 'x-notion-signature': signature } }),
    ).toBe(true);
  });

  it('rejects a body altered after signing', async () => {
    const rawBody = JSON.stringify(delivery());
    const signature = await signWebhookPayload({ body: rawBody, verificationToken: TOKEN });
    const tampered = JSON.stringify(delivery({ workspace_id: 'ws_attacker' }));
    expect(
      observer.verifySignature({
        rawBody: tampered,
        headers: { 'x-notion-signature': signature },
      }),
    ).toBe(false);
  });

  it('rejects a signature made with a different token', async () => {
    const rawBody = JSON.stringify(delivery());
    const signature = await signWebhookPayload({ body: rawBody, verificationToken: 'wrong' });
    expect(
      observer.verifySignature({ rawBody, headers: { 'x-notion-signature': signature } }),
    ).toBe(false);
  });

  it('rejects a missing or malformed header rather than throwing', () => {
    const rawBody = JSON.stringify(delivery());
    expect(observer.verifySignature({ rawBody, headers: {} })).toBe(false);
    expect(
      observer.verifySignature({ rawBody, headers: { 'x-notion-signature': 'nonsense' } }),
    ).toBe(false);
    // A short digest must not throw: `timingSafeEqual` rejects mismatched lengths by exception.
    expect(
      observer.verifySignature({ rawBody, headers: { 'x-notion-signature': 'sha256=ab' } }),
    ).toBe(false);
  });

  it('rejects a body that is not JSON', () => {
    expect(observer.verifySignature({ rawBody: 'not json', headers: {} })).toBe(false);
  });

  it('accepts the unsigned handshake, which structurally cannot be signed', () => {
    // It is the delivery that carries the signing token, so requiring a signature on it would
    // make a subscription impossible to establish.
    const rawBody = JSON.stringify({ verification_token: TOKEN });
    expect(observer.verifySignature({ rawBody, headers: {} })).toBe(true);
  });
});

describe('routing', () => {
  it('routes a delivery by workspace, and dedupes by the delivery id', () => {
    expect(observer.route(delivery())).toEqual({
      externalEventId: 'evt_1',
      eventType: 'page.properties_updated',
      externalWorkspaceId: 'ws_1',
    });
  });

  it('records the handshake unrouted, so the token can be read back from the inbox', () => {
    const routed = observer.route({ verification_token: TOKEN });
    expect(routed?.eventType).toBe(NOTION_VERIFICATION_EVENT);
    expect(routed?.externalWorkspaceId).toBeUndefined();
  });

  it('returns null for a payload it does not recognise', () => {
    expect(observer.route({ hello: 'world' })).toBeNull();
    expect(observer.route('nope')).toBeNull();
    expect(observer.route(null)).toBeNull();
  });
});

describe('normalize', () => {
  it('emits no activity events', () => {
    // Notion webhooks wake the mirror's pull-back; they are not an activity feed source, and
    // Docket's source_system enum has no `notion` member to attribute a draft to.
    expect(
      observer.normalize({
        eventType: 'page.properties_updated',
        payload: delivery(),
        receivedAt: '2026-08-08T00:00:00.000Z',
      }),
    ).toEqual([]);
  });
});

describe('echo suppression', () => {
  const BOT = 'bot_docket';

  it('drops a delivery authored solely by our own bot', () => {
    // Docket's push fires a webhook; replaying it would pull, push, and loop forever.
    expect(isSelfAuthored(delivery({ authors: [{ id: BOT, type: 'bot' }] }), BOT)).toBe(true);
  });

  it('keeps a delivery a person also authored', () => {
    // The window where Docket wrote and a human also edited is exactly when a real change is at
    // stake; discarding it would lose their edit.
    expect(
      isSelfAuthored(
        delivery({
          authors: [
            { id: BOT, type: 'bot' },
            { id: 'person_1', type: 'person' },
          ],
        }),
        BOT,
      ),
    ).toBe(false);
  });

  it('keeps a delivery from another integration bot', () => {
    // A real workspace runs several bots. Only OUR writes are echoes.
    expect(isSelfAuthored(delivery({ authors: [{ id: 'bot_sunsama', type: 'bot' }] }), BOT)).toBe(
      false,
    );
  });

  it('keeps everything when our bot id is unknown', () => {
    // Failing open is right here: suppressing on an unknown id would silently drop real edits,
    // while a missed suppression only costs one redundant no-op sync pass.
    expect(isSelfAuthored(delivery({ authors: [{ id: BOT, type: 'bot' }] }), undefined)).toBe(
      false,
    );
    expect(isSelfAuthored(delivery({ authors: [{ id: BOT, type: 'bot' }] }), '')).toBe(false);
  });

  it('keeps a delivery with no authors at all', () => {
    expect(isSelfAuthored(delivery({ authors: [] }), BOT)).toBe(false);
    expect(isSelfAuthored({ id: 'x' }, BOT)).toBe(false);
  });
});

describe('readVerificationToken', () => {
  it('reads the handshake token', () => {
    expect(readVerificationToken({ verification_token: 'tok' })).toBe('tok');
  });

  it('ignores a real event that happens to carry the field', () => {
    // A typed delivery always has `type`; treating one as a handshake would skip its signature.
    expect(
      readVerificationToken({ type: 'page.created', verification_token: 'tok' }),
    ).toBeUndefined();
  });
});
