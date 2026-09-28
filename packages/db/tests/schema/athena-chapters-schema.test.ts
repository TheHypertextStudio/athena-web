/** Chapter markers belong to their conversation and allow only one open span. */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import { agentSession, athenaConversationChapter, sessionActivity, user } from '../../src/schema';

const client = new PGlite('memory://');
const db = drizzle(client);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
});

afterAll(async () => {
  await client.close();
});

it('keeps chapter anchors in the owner conversation and permits only one open chapter', async () => {
  const referencedTables = getTableConfig(athenaConversationChapter).foreignKeys.map(
    (key) => getTableConfig(key.reference().foreignTable).name,
  );
  expect(referencedTables).toEqual(
    expect.arrayContaining(['agent_session', 'user', 'session_activity']),
  );

  const [owner, other] = await db
    .insert(user)
    .values([
      { name: 'Owner', email: 'athena-chapter-owner@example.com' },
      { name: 'Other', email: 'athena-chapter-other@example.com' },
    ])
    .returning({ id: user.id });
  const ownerId = assertDefined(owner).id;
  const otherId = assertDefined(other).id;
  const [conversation, foreignConversation] = await db
    .insert(agentSession)
    .values([
      { executorKind: 'athena', ownerUserId: ownerId, kind: 'chat', trigger: 'delegation' },
      { executorKind: 'athena', ownerUserId: otherId, kind: 'chat', trigger: 'delegation' },
    ])
    .returning({ id: agentSession.id });
  const sessionId = assertDefined(conversation).id;
  const foreignSessionId = assertDefined(foreignConversation).id;
  const [first, second, foreign] = await db
    .insert(sessionActivity)
    .values([
      { sessionId, type: 'response', body: { text: 'Start', author: 'user' } },
      { sessionId, type: 'response', body: { text: 'End', author: 'athena' } },
      { sessionId: foreignSessionId, type: 'response', body: { text: 'Private' } },
    ])
    .returning({ id: sessionActivity.id });
  const startId = assertDefined(first).id;
  const endId = assertDefined(second).id;

  const [chapter] = await db
    .insert(athenaConversationChapter)
    .values({ sessionId, ownerUserId: ownerId, startActivityId: startId, title: 'Planning' })
    .returning();
  const saved = assertDefined(chapter);
  expect(saved.id).toBeTruthy();
  expect(saved.createdAt).toBeInstanceOf(Date);
  await expect(
    db.insert(athenaConversationChapter).values({
      sessionId,
      ownerUserId: ownerId,
      startActivityId: endId,
      title: 'Second open chapter',
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'athena_conversation_chapter_open_uq' } });
  await expect(
    db.insert(athenaConversationChapter).values({
      sessionId,
      ownerUserId: otherId,
      startActivityId: endId,
      endActivityId: endId,
      title: 'Wrong owner',
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'athena_conversation_chapter_owner_fk' } });
  await expect(
    db.insert(athenaConversationChapter).values({
      sessionId,
      ownerUserId: ownerId,
      startActivityId: assertDefined(foreign).id,
      endActivityId: endId,
      title: 'Wrong conversation',
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'athena_conversation_chapter_start_fk' } });

  const [closed] = await db
    .update(athenaConversationChapter)
    .set({ endActivityId: endId })
    .where(eq(athenaConversationChapter.id, saved.id))
    .returning();
  expect(assertDefined(closed).updatedAt.getTime()).toBeGreaterThanOrEqual(
    saved.createdAt.getTime(),
  );
  await expect(
    db.insert(athenaConversationChapter).values({
      sessionId,
      ownerUserId: ownerId,
      startActivityId: endId,
      title: 'Next chapter',
    }),
  ).resolves.toBeDefined();
});
