/**
 * The sweep that converts prose still written in the old shortcode mention form.
 *
 * @remarks
 * This runs over documents real people wrote and rewrites them in place, so the cases worth the
 * database are the ones a pure test cannot reach: that it finds the rows across every table that
 * can hold prose, that it leaves untouched anything it does not understand, and that running it
 * twice is the same as running it once. The rewrite's own grammar is covered next door against no
 * database at all.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { sweepLegacyMentions } from '../../src/content/legacy-mention-sweep';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** Create a task carrying `description`, and hand back its id. */
async function seedTask(orgId: string, teamId: string, description: string): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'Carrier', description, state: 'todo' })
      .returning({ id: schema.task.id }),
  ).id;
}

/** Create a task with a specific `title` and no description, and hand back its id. */
async function seedTaskTitled(orgId: string, teamId: string, title: string): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title, state: 'todo' })
      .returning({ id: schema.task.id }),
  ).id;
}

/** Read a task's description back. */
async function readTask(id: string): Promise<string> {
  const rows = await db
    .select({ description: schema.task.description })
    .from(schema.task)
    .where(eq(schema.task.id, id));
  return rows[0]?.description ?? '';
}

describe('sweepLegacyMentions', () => {
  it('rewrites a shortcode into the link form and leaves the rest of the prose alone', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const target = await seedTask(orgId, teamId, 'Ship it');
    const carrier = await seedTask(
      orgId,
      teamId,
      `Blocked by [mention kind="task" id="${target}" label="Ship it"] until Friday.`,
    );

    const result = await sweepLegacyMentions(db);
    expect(result.rewritten).toBeGreaterThanOrEqual(1);

    const after = await readTask(carrier);
    expect(after).toContain(`"docket:v1:task:${target}"`);
    expect(after).toContain(`/orgs/${orgId}/tasks/${target}`);
    expect(after.startsWith('Blocked by [Ship it](')).toBe(true);
    expect(after.endsWith(' until Friday.')).toBe(true);
    expect(after).not.toContain('[mention ');
  });

  it('looks up the real name for a shortcode with no captured label, not a placeholder', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const target = await seedTaskTitled(orgId, teamId, 'Renovate the loading dock');
    const carrier = await seedTask(
      orgId,
      teamId,
      `Blocked by [mention kind="task" id="${target}"] until Friday.`,
    );

    await sweepLegacyMentions(db);

    const after = await readTask(carrier);
    // The id still appears in the href and the machine-reference title, so this checks the *link
    // text* specifically starts with the real name rather than the id — not that the id is absent.
    expect(after.startsWith('Blocked by [Renovate the loading dock](')).toBe(true);
  });

  it('never resolves a name across orgs, even when the id belongs to a real task elsewhere', async () => {
    const other = await seedBaseOrg(db, schema);
    const foreign = await seedTaskTitled(other.orgId, other.teamId, 'Confidential renovation plan');

    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const carrier = await seedTask(orgId, teamId, `See [mention kind="task" id="${foreign}"].`);

    await sweepLegacyMentions(db);

    const after = await readTask(carrier);
    expect(after).not.toContain('Confidential renovation plan');
    // Same treatment as a deleted/unreachable entity: a generic kind label, not the foreign name.
    expect(after).toContain('[Task](');
  });

  it('falls back to a kind-based label only when the referenced entity is gone', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const target = await seedTask(orgId, teamId, 'Temporary');
    await db.delete(schema.task).where(eq(schema.task.id, target));
    const carrier = await seedTask(orgId, teamId, `See [mention kind="task" id="${target}"].`);

    await sweepLegacyMentions(db);

    expect(await readTask(carrier)).toContain('[Task](');
  });

  it('finds prose in a `body` column too, not only `description`', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const target = await seedTask(orgId, teamId, 'Referenced');
    const commentId = one(
      await db
        .insert(schema.comment)
        .values({
          organizationId: orgId,
          subjectType: 'task',
          subjectId: target,
          body: `See [mention kind="task" id="${target}" label="Referenced"]`,
        })
        .returning({ id: schema.comment.id }),
    ).id;

    await sweepLegacyMentions(db);

    const rows = await db
      .select({ body: schema.comment.body })
      .from(schema.comment)
      .where(eq(schema.comment.id, commentId));
    expect(rows[0]?.body).toContain(`"docket:v1:task:${target}"`);
  });

  it('leaves a row it cannot convert exactly as it found it, and counts it', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    // A shortcode naming a kind with no route. Rewriting it would invent a destination.
    const prose = 'Ref [mention kind="unicorn" id="u1" label="Nope"]';
    const carrier = await seedTask(orgId, teamId, prose);

    const result = await sweepLegacyMentions(db);
    expect(result.unchanged).toBeGreaterThanOrEqual(1);
    expect(await readTask(carrier)).toBe(prose);
  });

  it('is idempotent, so a sweep that dies halfway can simply run again', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const target = await seedTask(orgId, teamId, 'Twice');
    const carrier = await seedTask(
      orgId,
      teamId,
      `[mention kind="task" id="${target}" label="Twice"]`,
    );

    await sweepLegacyMentions(db);
    const afterFirst = await readTask(carrier);
    const second = await sweepLegacyMentions(db);
    expect(await readTask(carrier)).toBe(afterFirst);
    // Nothing left matching the needle means the second pass had no work at all.
    expect(second.rewritten).toBe(0);
  });

  it('does not touch prose that never held a shortcode', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const prose = 'Plain words with a [link](https://example.com) and nothing else.';
    const carrier = await seedTask(orgId, teamId, prose);

    await sweepLegacyMentions(db);
    expect(await readTask(carrier)).toBe(prose);
  });
});
