import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getMigratedDb } from '../support/db';
import { saveTranscript } from '../../src/agent/transcript';
import { assertDefined } from '@docket/test-utils';

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
        contextOrganizationId: assertDefined(org).id,
        agentId: null,
        ownerUserId: assertDefined(owner).id,
        trigger: 'delegation',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionTranscript).values({
      sessionId: assertDefined(session).id,
      organizationId: null,
      ownerUserId: assertDefined(owner).id,
      messages: [],
    });

    await saveTranscript(
      schema.db,
      assertDefined(session).id,
      assertDefined(org).id,
      [{ role: 'user', content: [{ type: 'text', text: 'Private context' }] }],
      assertDefined(owner).id,
    );

    const [transcript] = await schema.db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, assertDefined(session).id));
    expect(transcript).toMatchObject({
      organizationId: null,
      ownerUserId: assertDefined(owner).id,
    });
  });
});
