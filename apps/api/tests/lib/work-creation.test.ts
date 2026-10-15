import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import * as projections from '../../src/search/write-through';
import { flushDeferredWork } from '../../src/lib/after-response';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  return {
    ...base,
    caller: {
      orgId: base.orgId,
      actorId: base.humanActorId,
      roleId: null,
      capabilities: ['manage'],
    },
  };
}

describe('ordinary creation parity', () => {
  it('includes every explicit checkpoint in the project creation undo receipt', async () => {
    const base = await fixture();
    const router = (await import('../../src/routes/projects')).default;
    const app = appWithActor(router, base.orgId, ['manage'], base.humanActorId);
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Checkpoint receipt',
        milestones: [{ name: 'First' }, { name: 'Last' }],
      }),
    });
    expect(response.status).toBe(201);
    const entries = await schema.db
      .select({ kind: schema.changeSetEntry.entityKind })
      .from(schema.changeSetEntry)
      .innerJoin(schema.changeSet, eq(schema.changeSetEntry.changeSetId, schema.changeSet.id))
      .where(eq(schema.changeSet.organizationId, base.orgId));
    expect(entries.map((entry) => entry.kind).sort()).toEqual([
      'milestone',
      'milestone',
      'project',
    ]);
  });
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'creates distinct equal-name %s rows with one receipt each',
    async (kind) => {
      const base = await fixture();
      const routers = {
        task: () => import('../../src/routes/tasks'),
        project: () => import('../../src/routes/projects'),
        initiative: () => import('../../src/routes/initiatives'),
        program: () => import('../../src/routes/programs'),
      };
      const router = (await routers[kind]()).default;
      const app = appWithActor(router, base.orgId, ['manage'], base.humanActorId);
      const body =
        kind === 'task'
          ? { title: 'Equal name', teamId: base.teamId, state: 'done' }
          : { name: 'Equal name' };
      const ids: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(201);
        const row = (await response.json()) as {
          id: string;
          workTypeId: string;
          workTypeVersionId: string;
          state?: string;
        };
        expect(row.workTypeId).toBeTruthy();
        expect(row.workTypeVersionId).toBeTruthy();
        if (kind === 'task') expect(row.state).toBe('done');
        ids.push(row.id);
      }
      expect(new Set(ids).size).toBe(2);
      const receipts = await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, base.orgId));
      expect(receipts).toHaveLength(2);
      expect(receipts.every((row) => row.actorId === base.humanActorId)).toBe(true);
    },
  );
});

describe('transaction-aware ordinary creation', () => {
  it('rolls back the root and first checkpoint when the final physical checkpoint insert fails', async () => {
    const base = await fixture();
    const { createWorkInTransaction } = await import('../../src/lib/work-creation/service');
    await expect(
      schema.db.transaction(async (tx) => {
        await tx.execute(
          sql`CREATE FUNCTION pg_temp.reject_final_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = 'Reject final checkpoint' THEN RAISE EXCEPTION 'Final checkpoint rejected'; END IF; RETURN NEW; END $$`,
        );
        await tx.execute(
          sql`CREATE TRIGGER reject_final_checkpoint BEFORE INSERT ON milestone FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_final_checkpoint()`,
        );
        await createWorkInTransaction(tx, {
          caller: base.caller,
          kind: 'project',
          body: {
            name: 'Atomic checkpoints',
            milestones: [{ name: 'First checkpoint' }, { name: 'Reject final checkpoint' }],
          },
          invocation: { origin: { ...appProvenance(), v: 2, tool: 'project_create' } },
        });
      }),
    ).rejects.toThrow();
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, base.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.organizationId, base.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, base.orgId)),
    ).toEqual([]);
  });

  it('joins an enclosing transaction and rolls back work, milestones and its receipt', async () => {
    const base = await fixture();
    const { createWorkInTransaction } = await import('../../src/lib/work-creation/service');
    await expect(
      runWithProvenance(appProvenance(), () =>
        schema.db.transaction(async (tx) => {
          const created = await createWorkInTransaction(tx, {
            caller: base.caller,
            kind: 'project',
            body: { name: 'Rolled back', milestones: [{ name: 'Last checkpoint' }] },
            invocation: { origin: { ...appProvenance(), v: 2, tool: 'project_create' } },
          });
          expect(created.created.map((row) => row.kind)).toEqual(['project', 'milestone']);
          expect(created.changeSetId).toBeTruthy();
          throw new Error('Enclosing plan rejected');
        }),
      ),
    ).rejects.toThrow('Enclosing plan rejected');
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, base.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.organizationId, base.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, base.orgId)),
    ).toEqual([]);
  });

  it('records an explicit project milestone in the same undo receipt', async () => {
    const base = await fixture();
    const { createWork } = await import('../../src/lib/work-creation/service');
    const result = await createWork({
      caller: base.caller,
      kind: 'project',
      body: { name: 'Checkpoints', milestones: [{ name: 'Review', sort: 7 }] },
      invocation: { origin: { ...appProvenance(), v: 2, tool: 'project_create' } },
    });
    expect(result.created.map((row) => row.kind)).toEqual(['project', 'milestone']);
    const entries = await schema.db
      .select()
      .from(schema.changeSetEntry)
      .where(
        and(
          eq(schema.changeSetEntry.changeSetId, result.changeSetId ?? ''),
          eq(schema.changeSetEntry.entityKind, 'milestone'),
        ),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.op).toBe('create');
  });

  it('returns committed work and its receipt when an after-commit projection fails', async () => {
    const base = await fixture();
    const { createWork } = await import('../../src/lib/work-creation/service');
    const projection = vi
      .spyOn(projections, 'enqueueSearchUpsert')
      .mockRejectedValue(new Error('Index unavailable'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await createWork({
        caller: base.caller,
        kind: 'project',
        body: { name: 'Committed despite index failure' },
        invocation: { origin: { ...appProvenance(), v: 2, tool: 'project_create' } },
      });
      await flushDeferredWork();
      expect(result.changeSetId).toBeTruthy();
      expect(
        await schema.db
          .select()
          .from(schema.project)
          .where(eq(schema.project.organizationId, base.orgId)),
      ).toHaveLength(1);
      expect(
        await schema.db
          .select()
          .from(schema.changeSet)
          .where(eq(schema.changeSet.organizationId, base.orgId)),
      ).toHaveLength(1);
    } finally {
      projection.mockRestore();
      errors.mockRestore();
    }
  });
});
