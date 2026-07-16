import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getMigratedDb } from '../support/db';
import { saveTranscript } from '../../src/agent/transcript';

describe('saveTranscript ownership', () => {
  it('ignores workspace context when updating a user-owned Athena transcript', async () => {
    const schema = await getMigratedDb();
    const suffix = Math.random().toString(36).slice(2, 10);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Owner', email: `transcript-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const [org] = await schema.db
      .insert(schema.organization)
      .values({ name: `Transcript ${suffix}`, slug: `transcript-${suffix}` })
      .returning({ id: schema.organization.id });
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        organizationId: null,
        contextOrganizationId: org!.id,
        agentId: null,
        ownerUserId: owner!.id,
        trigger: 'delegation',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionTranscript).values({
      sessionId: session!.id,
      organizationId: null,
      ownerUserId: owner!.id,
      messages: [],
    });

    await saveTranscript(
      schema.db,
      session!.id,
      org!.id,
      [{ role: 'user', content: [{ type: 'text', text: 'Private context' }] }],
      owner!.id,
    );

    const [transcript] = await schema.db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, session!.id));
    expect(transcript).toMatchObject({
      organizationId: null,
      ownerUserId: owner!.id,
    });
  });
});
