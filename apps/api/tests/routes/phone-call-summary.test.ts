/** Post-call notification and Undo stay scoped to the authenticated phone session. */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveCanonicalConversation } from '../../src/routes/agent-dispatch';
import {
  loadPhoneCallSummary,
  publishPhoneCallSummary,
  undoPhoneCallChange,
} from '../../src/routes/phone-call-summary';
import { DocketVoiceToolRunner } from '../../src/routes/voice-tools';
import { getDb, seedTaskAccessOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('phone call summary', () => {
  it('publishes one durable review and undoes its single task creation', async () => {
    const { orgId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'PhoneCallSummary');
    const conversation = await resolveCanonicalConversation(userId, orgId, humanActorId);
    const [session] = await db
      .insert(schema.voiceSession)
      .values({
        conversationId: conversation.id,
        userId,
        organizationId: orgId,
        channel: 'phone',
        callSid: `CA_summary_${Math.random().toString(36).slice(2)}`,
        provider: 'twilio-relay',
      })
      .returning();
    if (!session) throw new Error('voice session insert returned no row');

    const outcome = await new DocketVoiceToolRunner().run(
      {
        voiceSessionId: session.id,
        conversationId: conversation.id,
        userId,
        organizationId: orgId,
        channel: 'phone',
        initiatorActorId: humanActorId,
      },
      'create_task',
      { title: 'Book the inspection' },
    );
    if (!outcome.changeSetId) throw new Error('voice change set missing');
    await db
      .update(schema.voiceSession)
      .set({ status: 'ended', endedAt: new Date(), endedReason: 'caller_hung_up' })
      .where(eq(schema.voiceSession.id, session.id));

    await publishPhoneCallSummary(session.id);
    await publishPhoneCallSummary(session.id);

    const summary = await loadPhoneCallSummary(userId, session.id);
    expect(summary.changes).toEqual([
      expect.objectContaining({
        changeSetId: outcome.changeSetId,
        tool: 'create_task',
        undoAvailable: true,
      }),
    ]);
    const notices = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, `phone_call_${session.id}`));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: 'phone_call', userId });

    await undoPhoneCallChange(userId, session.id, outcome.changeSetId);
    const tasks = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.title, 'Book the inspection'));
    expect(tasks[0]?.archivedAt).not.toBeNull();
    await expect(undoPhoneCallChange(userId, session.id, outcome.changeSetId)).rejects.toThrow();
  });
});
