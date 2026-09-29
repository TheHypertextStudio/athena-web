/** Chapter markers stay owned, ordered, and separate from the conversation's messages. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as ChaptersModule from '../../src/routes/me-athena-chapters';
import { assertDefined } from '@docket/test-utils';

import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let chapters!: typeof ChaptersModule;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  chapters = await import('../../src/routes/me-athena-chapters');
});

/** Two messages in one owner's personal conversation. */
async function seed() {
  const slug = Math.random().toString(36).slice(2, 10);
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `chapter-${slug}@example.com` })
    .returning({ id: schema.user.id });
  const ownerUserId = assertDefined(owner).id;
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'completed',
      workLinkage: 'conversation',
    })
    .returning({ id: schema.agentSession.id });
  const sessionId = assertDefined(session).id;
  const [first, second] = await db
    .insert(schema.sessionActivity)
    .values([
      {
        sessionId,
        type: 'response',
        body: { text: 'Start', author: 'user' },
        createdAt: new Date('2026-09-28T10:00:00Z'),
      },
      {
        sessionId,
        type: 'response',
        body: { text: 'End', author: 'athena' },
        createdAt: new Date('2026-09-28T10:01:00Z'),
      },
    ])
    .returning({ id: schema.sessionActivity.id });
  return {
    ownerUserId,
    sessionId,
    first: assertDefined(first).id,
    second: assertDefined(second).id,
  };
}

describe('personal Athena chapters', () => {
  it('persists a start and end without changing the messages', async () => {
    const seeded = await seed();
    const started = await chapters.startAthenaChapter(seeded.ownerUserId, seeded.sessionId, {
      startActivityId: seeded.first,
      title: 'Launch review',
    });
    expect(started.endActivityId).toBeNull();
    const ended = await chapters.endAthenaChapter(
      seeded.ownerUserId,
      seeded.sessionId,
      started.id,
      seeded.second,
    );
    expect(ended.endActivityId).toBe(seeded.second);
    expect(
      (await chapters.listAthenaChapters(seeded.ownerUserId, seeded.sessionId)).items,
    ).toMatchObject([
      { title: 'Launch review', startActivityId: seeded.first, endActivityId: seeded.second },
    ]);
    const activities = await db.select().from(schema.sessionActivity);
    expect(activities.filter((activity) => activity.sessionId === seeded.sessionId)).toHaveLength(
      2,
    );
  });

  it('rejects a second open chapter and an end before the start', async () => {
    const seeded = await seed();
    const started = await chapters.startAthenaChapter(seeded.ownerUserId, seeded.sessionId, {
      startActivityId: seeded.second,
      title: 'Late chapter',
    });
    await expect(
      chapters.startAthenaChapter(seeded.ownerUserId, seeded.sessionId, {
        startActivityId: seeded.first,
        title: 'Overlapping chapter',
      }),
    ).rejects.toThrow('Finish the current saved place first');
    await expect(
      chapters.endAthenaChapter(seeded.ownerUserId, seeded.sessionId, started.id, seeded.first),
    ).rejects.toThrow('The end must follow the start');
    await expect(
      chapters.endAthenaChapter(seeded.ownerUserId, seeded.sessionId, started.id, seeded.second),
    ).rejects.toThrow('The end must follow the start');
  });

  it('does not let another owner read or remove a chapter', async () => {
    const first = await seed();
    const other = await seed();
    const started = await chapters.startAthenaChapter(first.ownerUserId, first.sessionId, {
      startActivityId: first.first,
      title: 'Private chapter',
    });
    expect(
      (await chapters.listAthenaChapters(other.ownerUserId, first.sessionId)).items,
    ).toHaveLength(0);
    await expect(
      chapters.deleteAthenaChapter(other.ownerUserId, first.sessionId, started.id),
    ).rejects.toThrow('Saved place not found');
    await chapters.deleteAthenaChapter(first.ownerUserId, first.sessionId, started.id);
    expect(
      (await chapters.listAthenaChapters(first.ownerUserId, first.sessionId)).items,
    ).toHaveLength(0);
  });
});
