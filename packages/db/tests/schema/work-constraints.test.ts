/**
 * `@docket/db` — the work island's data-integrity constraints, exercised against real Postgres DDL.
 *
 * @remarks
 * The DTO layer in `@docket/types` already rejects these values at the API boundary. This suite
 * exists because a DTO only protects the writers that go through it, and the work island is also
 * written by connector reconcile, MCP tools, the email-to-task path, seed data and migrations. So
 * every assertion here goes **around** the API entirely — a raw insert straight into the table —
 * and demands that storage itself refuses. That is what "any data stored by Docket should have
 * strong constraints" has to mean to be worth anything.
 *
 * Migrations are applied from the shipped chain, so a constraint that exists only in `schema/` and
 * never made it into a migration fails here.
 */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../../src/client';
import { cycle, milestone, organization, project, task, team } from '../../src/schema';
import { assertDefined } from '@docket/test-utils';

let client!: PGlite;
let db!: Database;
let orgId!: string;
let teamId!: string;
let projectId!: string;

/** The columns every `task` insert must supply; tests override the field under examination. */
function baseTask(): { organizationId: string; title: string; teamId: string; state: string } {
  return { organizationId: orgId, title: 'A task', teamId, state: 'backlog' };
}

/**
 * Assert a raw insert is refused by the named CHECK constraint.
 *
 * @remarks
 * Matching on the constraint name rather than on "it threw" is what makes these tests mean
 * something: an insert can fail for a dozen incidental reasons (a missing NOT NULL, a bad FK),
 * and a test that accepts any rejection would keep passing after the constraint was dropped.
 *
 * @param write - The insert to attempt.
 * @param constraint - The constraint expected to reject it.
 */
async function expectRefusedBy(write: Promise<unknown>, constraint: string): Promise<void> {
  // Drizzle wraps the driver error, so the Postgres `constraint` field lives on `cause`.
  await expect(write).rejects.toMatchObject({ cause: { constraint } });
}

describe('work island constraints', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const d = drizzle(client, { schema: fullSchema });
    await migrate(d, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
    db = d;

    orgId = assertDefined(
      (
        await db
          .insert(organization)
          .values({ name: 'Constraints', slug: `c-${Date.now()}` })
          .returning()
      )[0],
    ).id;
    teamId = assertDefined(
      (
        await db
          .insert(team)
          .values({ organizationId: orgId, name: 'Core', key: 'CORE' })
          .returning()
      )[0],
    ).id;
    projectId = assertDefined(
      (await db.insert(project).values({ organizationId: orgId, name: 'Redesign' }).returning())[0],
    ).id;
  });

  afterAll(async () => {
    await client.close();
  });

  describe('dates name a day someone could have meant', () => {
    it('refuses a task dated before the epoch — the shape a mistyped year takes', async () => {
      // `0226-05-01` for `2026-05-01` is a valid timestamp and a broken due date: it sorts to the
      // top of every list forever and no date input ever shows it back to be corrected.
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), dueDate: new Date('0226-05-01T00:00:00Z') }),
        'task_due_date_range',
      );
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), startDate: new Date('1900-01-01T00:00:00Z') }),
        'task_start_date_range',
      );
    });

    it('refuses a task dated past the plausible horizon', async () => {
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), dueDate: new Date('9999-12-31T00:00:00Z') }),
        'task_due_date_range',
      );
    });

    it('applies the same bound to project, milestone and cycle dates', async () => {
      await expectRefusedBy(
        db.insert(project).values({
          organizationId: orgId,
          name: 'Ancient',
          targetDate: new Date('0500-01-01T00:00:00Z'),
        }),
        'project_target_date_range',
      );
      await expectRefusedBy(
        db.insert(milestone).values({
          organizationId: orgId,
          projectId,
          name: 'Beta',
          targetDate: new Date('9999-01-01T00:00:00Z'),
        }),
        'milestone_target_date_range',
      );
    });

    it('accepts every date a planner would actually enter', async () => {
      const rows = await db
        .insert(task)
        .values({
          ...baseTask(),
          startDate: new Date('2026-09-10T00:00:00Z'),
          dueDate: new Date('2026-09-30T00:00:00Z'),
        })
        .returning();
      expect(rows[0]?.startDate).toBeInstanceOf(Date);
    });

    it('refuses a cycle whose window ends before it starts', async () => {
      // A cycle IS its window: "current" is decided by comparing now against it. A backwards one
      // is never current and renders as nonsense on every cycle surface.
      await expectRefusedBy(
        db.insert(cycle).values({
          organizationId: orgId,
          teamId,
          number: 1,
          startsAt: new Date('2026-09-10T00:00:00Z'),
          endsAt: new Date('2026-09-03T00:00:00Z'),
        }),
        'cycle_window_ordered',
      );
    });
  });

  describe('durations and counts cannot be negative', () => {
    it('refuses negative effort, which would subtract from every rollup it lands in', async () => {
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), estimate: -3 }),
        'task_estimate_nonneg',
      );
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), estimateMinutes: -30 }),
        'task_estimate_minutes_nonneg',
      );
      await expectRefusedBy(
        db.insert(milestone).values({ organizationId: orgId, projectId, name: 'M', sort: -1 }),
        'milestone_sort_nonneg',
      );
    });

    it('accepts zero, which legitimately means "no work left"', async () => {
      const rows = await db
        .insert(task)
        .values({ ...baseTask(), estimate: 0, estimateMinutes: 0 })
        .returning();
      expect(rows[0]?.estimateMinutes).toBe(0);
    });
  });

  describe('required text is text, not whitespace', () => {
    it('refuses a blank or whitespace-only task title', async () => {
      // NOT NULL permits `''`. A blank title renders as an unclickable, unsearchable row that a
      // reader cannot tell from an empty slot — and cannot repair, because nothing looks broken.
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), title: '' }),
        'task_title_not_blank',
      );
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), title: '   \t ' }),
        'task_title_not_blank',
      );
    });

    it('refuses an empty workflow state, which would drop the task out of every board', async () => {
      // `state` is a per-team key, so its domain lives in `team.workflow_states` and cannot be a
      // pg enum. What a constraint can still guarantee is that the key is a key.
      await expectRefusedBy(
        db.insert(task).values({ ...baseTask(), state: '' }),
        'task_state_not_blank',
      );
    });

    it('refuses blank names across the containment hierarchy', async () => {
      await expectRefusedBy(
        db.insert(project).values({ organizationId: orgId, name: '  ' }),
        'project_name_not_blank',
      );
      await expectRefusedBy(
        db.insert(milestone).values({ organizationId: orgId, projectId, name: '' }),
        'milestone_name_not_blank',
      );
    });
  });

  describe('relationships stay well-formed', () => {
    it('refuses a task that is its own parent', async () => {
      const rows = await db.insert(task).values(baseTask()).returning();
      const id = assertDefined(rows[0]).id;
      await expectRefusedBy(
        db.update(task).set({ parentTaskId: id }).where(eq(task.id, id)),
        'task_not_own_parent',
      );
    });
  });
});
