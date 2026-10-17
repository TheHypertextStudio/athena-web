import type * as Environment from '../../../src/env';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { signSvixPayload } from '@docket/mail';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { receiveMailProviderEvent } from '../../../src/services/athena-mail/provider-events';
import { reconcileMailProviderEvents } from '../../../src/services/athena-mail/outbox';

const signingSecret =
  'whsec_' + Buffer.from('isolated-provider-event-test-secret').toString('base64');
vi.mock('../../../src/env', async (importOriginal) => {
  const actual = await importOriginal<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      RESEND_INBOUND_WEBHOOK_SECRET:
        'whsec_' + Buffer.from('isolated-provider-event-test-secret').toString('base64'),
    },
  };
});
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
function event(type: string, providerId: string) {
  const body = JSON.stringify({ type, data: { email_id: providerId } });
  const id = `event-${Math.random()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signSvixPayload(signingSecret, id, timestamp, body)}`,
    },
  };
}
async function intent(providerMessageId: string | null) {
  const { owner, mailbox } = await enrolled(schema);
  const [row] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      toAddress: assertDefined(mailbox.ownerAddress),
      subject: 'Delivery receipt test',
      bodyText: 'Receipt test',
      status: 'sent',
      providerMessageId,
    })
    .returning();
  return assertDefined(row);
}
async function status(id: string) {
  const [row] = await schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.id, id));
  return assertDefined(row).status;
}
describe('authenticated delivery receipts', () => {
  it.each([
    null,
    'not an event',
    { type: 'email.delivered' },
    { type: 'email.delivered', data: { email_id: 42 } },
  ])(
    'rejects a signed but malformed receipt without changing delivery state: %j',
    async (payload) => {
      const target = await intent(`malformed-${Math.random()}`);
      const body = JSON.stringify(payload);
      const id = `invalid-shape-${Math.random()}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const headers = {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signSvixPayload(signingSecret, id, timestamp, body)}`,
      };
      expect(await receiveMailProviderEvent(body, headers)).toBe(false);
      expect(await status(target.id)).toBe('sent');
    },
  );

  it('rejects unsigned and modified events without changing a send or another owner', async () => {
    const id = `provider-${Math.random()}`;
    const target = await intent(id);
    const other = await intent(`other-${Math.random()}`);
    const delivered = event('email.delivered', id);
    expect(await receiveMailProviderEvent(delivered.body, {})).toBe(false);
    expect(
      await receiveMailProviderEvent(
        delivered.body.replace('email.delivered', 'email.bounced'),
        delivered.headers,
      ),
    ).toBe(false);
    expect(await status(target.id)).toBe('sent');
    expect(await status(other.id)).toBe('sent');
    const unrelated = event('email.delivered', `unknown-${Math.random()}`);
    expect(await receiveMailProviderEvent(unrelated.body, unrelated.headers)).toBe(true);
    expect(await status(target.id)).toBe('sent');
    expect(await receiveMailProviderEvent(delivered.body, delivered.headers)).toBe(true);
    expect(await status(target.id)).toBe('delivered');
    expect(await status(other.id)).toBe('sent');
    expect(await receiveMailProviderEvent(delivered.body, delivered.headers)).toBe(true);
    expect(await status(target.id)).toBe('delivered');
  });
  it.each(['email.delivered', 'email.bounced'] as const)(
    'recovers %s arriving before provider acceptance is persisted',
    async (type) => {
      const provider = `racing-${Math.random()}`;
      const target = await intent(null);
      const callback = event(type, provider);
      expect(await receiveMailProviderEvent(callback.body, callback.headers)).toBe(true);
      expect(await status(target.id)).toBe('sent');
      await schema.db
        .update(schema.athenaMailOutbox)
        .set({ providerMessageId: provider })
        .where(eq(schema.athenaMailOutbox.id, target.id));
      await reconcileMailProviderEvents();
      expect(await status(target.id)).toBe(type === 'email.delivered' ? 'delivered' : 'bounced');
      await reconcileMailProviderEvents();
      expect(await status(target.id)).toBe(type === 'email.delivered' ? 'delivered' : 'bounced');
    },
  );
  it('does not let a later delivered callback erase a confirmed bounce', async () => {
    const provider = `bounced-${Math.random()}`;
    const target = await intent(provider);
    const bounce = event('email.bounced', provider);
    const delivered = event('email.delivered', provider);
    await receiveMailProviderEvent(bounce.body, bounce.headers);
    await receiveMailProviderEvent(delivered.body, delivered.headers);
    expect(await status(target.id)).toBe('bounced');
    const unsupported = event('email.opened', provider);
    expect(await receiveMailProviderEvent(unsupported.body, unsupported.headers)).toBe(true);
    expect(await status(target.id)).toBe('bounced');
  });
});
