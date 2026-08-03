/**
 * The rare combination where *neither* link-back lands: the stream write produces no findable
 * event AND the Athena turn throws, so both `streamEventId` and `sessionId` stay `null`.
 * `deliverInboundMail` must still report `delivered` and skip the final link-back update
 * entirely rather than erroring — the row itself was already committed before either step ran.
 * Its own file so both mocks stay isolated from the rest of the suite.
 */
import type * as DbModule from '@docket/db';
import type { InboundMessage } from '@docket/mail';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AgentSessionRunnerModule from '../../src/routes/agent-session-runner';
import type * as EventEmitModule from '../../src/routes/event-emit';

vi.mock('../../src/routes/event-emit', async (importOriginal) => {
  const actual = await importOriginal<typeof EventEmitModule>();
  return { ...actual, emitInboundEmail: vi.fn(async () => undefined) };
});
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

describe('neither the stream write nor the Athena turn producing a link-back', () => {
  it('still reports delivered and leaves both link-back columns null, with no crash', async () => {
    const userId = await seedUserWithHub(db, schema, 'TotalGapOwner');
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
    expect(row?.streamEventId).toBeNull();
    expect(row?.sessionId).toBeNull();
  });
});
