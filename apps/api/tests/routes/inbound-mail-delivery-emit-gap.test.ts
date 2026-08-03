/**
 * Covers the branch where the universal-inbox stream write did not produce a findable event (the
 * `streamEventId` stays `null`) while the Athena turn still succeeds normally (`sessionId` is
 * set) — the mixed outcome no other suite constructs, since every other delivery test either has
 * both link-backs succeed or (in the turn-failure suite) only the stream link-back succeed. Its
 * own file so mocking `emitInboundEmail` into a no-op never leaks into a real stream-write
 * assertion elsewhere in the suite.
 */
import type * as DbModule from '@docket/db';
import type { InboundMessage } from '@docket/mail';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as EventEmitModule from '../../src/routes/event-emit';

vi.mock('../../src/routes/event-emit', async (importOriginal) => {
  const actual = await importOriginal<typeof EventEmitModule>();
  return {
    ...actual,
    // A no-op stand-in for "the stream write did not land": deliverInboundMail's own
    // `findStreamEventId` read-back then finds nothing to link, exactly as it would if the real
    // emit had silently failed to produce a row.
    emitInboundEmail: vi.fn(async () => undefined),
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

describe('the stream write not producing a findable event', () => {
  it('still delivers into the Athena conversation, leaving streamEventId unset', async () => {
    const userId = await seedUserWithHub(db, schema, 'EmitGapOwner');
    const { orgId } = await seedBaseOrg(db, schema);
    const key = `key${Math.random().toString(36).slice(2, 10)}`;
    await db
      .insert(schema.athenaMailbox)
      .values({ ownerUserId: userId, key, organizationId: orgId });

    const outcome = await deliverInboundMail(message([`${key}@${HOST}`]), 'fixture');
    expect(outcome.status).toBe('delivered');
    expect((outcome as { sessionId: string | null }).sessionId).not.toBeNull();

    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row?.streamEventId).toBeNull();
    expect(row?.sessionId).not.toBeNull();
  });
});
