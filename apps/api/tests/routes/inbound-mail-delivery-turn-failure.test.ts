/**
 * `deliverInboundMail`'s own claim: "the message is stored and visible; a failed turn must not
 * lose it." Forcing `postReplyAndResume` itself to throw is the only way to prove the delivery
 * function's `try`/`catch` around the Athena turn actually swallows the failure rather than
 * losing the already-committed row — every other suite exercises the turn succeeding. Its own
 * file so the mock never leaks into a real Athena turn elsewhere in the suite.
 */
import type * as DbModule from '@docket/db';
import type { InboundMessage } from '@docket/mail';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AgentSessionRunnerModule from '../../src/routes/agent-session-runner';

vi.mock('../../src/routes/agent-session-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentSessionRunnerModule>();
  return {
    ...actual,
    postReplyAndResume: vi.fn(async () => {
      throw new Error('the model call exploded');
    }),
  };
});

import type * as DeliveryModule from '../../src/routes/inbound-mail-delivery';
import { getDb, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let deliverInboundMail!: typeof DeliveryModule.deliverInboundMail;

const HOST = 'inbox.athena.docket.localhost';

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  deliverInboundMail = (await import('../../src/routes/inbound-mail-delivery')).deliverInboundMail;
});

function message(to: readonly string[]): InboundMessage {
  return {
    providerMessageId: `pm_${Math.random().toString(36).slice(2, 8)}`,
    rfc822MessageId: null,
    fromAddress: 'sender@example.com',
    fromName: 'Sender Name',
    cc: [],
    subject: 'A subject line',
    text: 'Body text',
    html: null,
    bodyStatus: 'complete',
    receivedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    attachments: [],
    to,
  };
}

describe('a failed Athena turn does not lose the stored message', () => {
  it('still stores and reports delivered, with no session id', async () => {
    const userId = await seedUserWithHub(db, schema, 'TurnFailureOwner');
    const { orgId } = await seedBaseOrg(db, schema);
    const key = `key${Math.random().toString(36).slice(2, 10)}`;
    await db
      .insert(schema.athenaMailbox)
      .values({ ownerUserId: userId, key, organizationId: orgId });

    const outcome = await deliverInboundMail(message([`${key}@${HOST}`]), 'fixture');
    expect(outcome.status).toBe('delivered');
    expect((outcome as { sessionId: string | null }).sessionId).toBeNull();

    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row).toBeDefined();
    expect(row?.sessionId).toBeNull();
    // The stream write (step 2) is unaffected by the turn (step 3) failing.
    expect(row?.streamEventId).not.toBeNull();
  });
});
