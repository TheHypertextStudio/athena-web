import { TaskCreate } from '@docket/work/task-model';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { getDb, seedBaseOrg, seedTaskAccessOrg } from '../support/routes-harness';
import { appProvenance } from '../../src/lib/provenance/context';
import {
  createOrdinaryPreparationContext,
  prospectiveWorkReference,
} from '../../src/lib/work-creation/ordinary-prospective';
import {
  createWorkInTransaction,
  prepareOrdinaryWork,
  createWorkBatchInTransaction,
} from '../../src/lib/work-creation/service';
import type { WorkCreationCommand } from '../../src/lib/work-creation/types';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const invocation = { origin: { ...appProvenance(), v: 2 as const, tool: 'project_create' } };
  const command: WorkCreationCommand<'project'> = {
    caller,
    kind: 'project',
    body: { name: 'Prepared root' },
    invocation,
  };
  return { ...base, command };
}

describe('ordinary creation authority', () => {
  it('uses the current persisted role rather than capabilities retained by a preview', async () => {
    const base = await seedBaseOrg(schema.db, schema);
    const [role] = await schema.db
      .insert(schema.role)
      .values({
        organizationId: base.orgId,
        key: 'editor',
        name: 'Editor',
        capabilities: ['contribute'],
      })
      .returning();
    if (!role) throw new Error('Role fixture missing');
    await schema.db
      .update(schema.actor)
      .set({ roleId: role.id })
      .where(eq(schema.actor.id, base.humanActorId));
    const command: WorkCreationCommand<'project'> = {
      caller: { orgId: base.orgId, actorId: base.humanActorId, roleId: role.id, capabilities: [] },
      kind: 'project',
      body: { name: 'Fresh role' },
      invocation: { origin: { ...appProvenance(), v: 2, tool: 'project_create' } },
    };
    await schema.db.transaction(async (tx) => {
      expect((await prepareOrdinaryWork(tx, command)).insert.kind).toBe('project');
    });
    await schema.db
      .update(schema.role)
      .set({ capabilities: ['view'] })
      .where(eq(schema.role.id, role.id));
    await expect(
      schema.db.transaction((tx) =>
        prepareOrdinaryWork(tx, {
          ...command,
          caller: { ...command.caller, capabilities: ['manage'] },
        }),
      ),
    ).rejects.toThrow();
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, base.orgId)),
    ).toEqual([]);
  });

  it('preserves the administrative Program creation threshold in trusted foreground adapters', async () => {
    const base = await seedTaskAccessOrg(schema.db, schema, 'contribute');
    await expect(
      schema.db.transaction((tx) =>
        createWorkInTransaction(tx, {
          caller: {
            orgId: base.orgId,
            actorId: base.humanActorId,
            roleId: null,
            capabilities: ['manage'],
          },
          kind: 'program',
          body: { name: 'Forbidden program' },
          invocation: { origin: { ...appProvenance(), v: 2, tool: 'program_create' } },
        }),
      ),
    ).rejects.toThrow();
    expect(
      await schema.db
        .select()
        .from(schema.program)
        .where(eq(schema.program.organizationId, base.orgId)),
    ).toEqual([]);
  });

  it('allows only checked prospective parents while preserving real team validation', async () => {
    const base = await fixture();
    const foreign = await seedBaseOrg(schema.db, schema);
    await schema.db.transaction(async (tx) => {
      const projectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const taskId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
      const context = await createOrdinaryPreparationContext(
        tx,
        base.command,
        [
          { id: projectId, orgId: base.orgId, kind: 'project', visibility: 'private' },
          { id: taskId, orgId: base.orgId, kind: 'task', visibility: 'private', projectId },
        ],
        'private',
      );
      const child: WorkCreationCommand<'task'> = {
        ...base.command,
        kind: 'task',
        body: TaskCreate.parse({ title: 'Prospective child', teamId: base.teamId, projectId }),
        invocation: { ...base.command.invocation, prospectiveWorkId: taskId },
      };
      const prepared = await prepareOrdinaryWork(tx, child, context);
      expect(prepared.insert.values.id).toBe(taskId);
      expect(prepared.insert.values).toMatchObject({ projectId, visibility: 'private' });
      await expect(
        prepareOrdinaryWork(
          tx,
          { ...child, body: TaskCreate.parse({ ...child.body, teamId: foreign.teamId }) },
          context,
        ),
      ).rejects.toThrow();
      expect(
        await tx.select().from(schema.project).where(eq(schema.project.organizationId, base.orgId)),
      ).toEqual([]);
    });
  });

  it('rejects copied context proofs, foreign rows and contexts from another transaction', async () => {
    const base = await fixture();
    const row = {
      id: 'planned-project',
      orgId: base.orgId,
      kind: 'project' as const,
      visibility: 'public' as const,
    };
    const context = await schema.db.transaction(async (tx) => {
      await expect(
        createOrdinaryPreparationContext(
          tx,
          base.command,
          [{ ...row, orgId: 'foreign' }],
          'public',
        ),
      ).rejects.toThrow();
      const checked = await createOrdinaryPreparationContext(tx, base.command, [row], 'public');
      expect(() =>
        prospectiveWorkReference(tx, base.command, { ...checked }, 'project', row.id),
      ).toThrow();
      expect(() => prospectiveWorkReference(tx, base.command, checked, 'task', row.id)).toThrow();
      return checked;
    });
    await schema.db.transaction(async (tx) => {
      expect(() =>
        prospectiveWorkReference(tx, base.command, context, 'project', row.id),
      ).toThrow();
    });
  });

  it('records equal-name forest roots and their dependency in one enclosing receipt', async () => {
    const base = await fixture();
    const roots = ['first', 'second'].map((key) => ({
      key,
      command: {
        ...base.command,
        kind: 'task' as const,
        body: TaskCreate.parse({ title: 'Independent equal names', teamId: base.teamId }),
      },
    }));
    const result = await schema.db.transaction((tx) =>
      createWorkBatchInTransaction(tx, {
        roots,
        invocation: base.command.invocation,
        edges: [
          { blocker: { rootKey: 'first', path: [] }, blocked: { rootKey: 'second', path: [] } },
        ],
      }),
    );
    expect(new Set([...result.rootsByKey.values()].map((root) => root.id)).size).toBe(2);
    for (const key of ['first', 'second']) {
      expect(result.selectedWorkByKey.get(key)).toEqual([
        { path: [], kind: 'task', id: result.rootsByKey.get(key)?.id },
      ]);
      expect(result.resolvedManifestsByKey.get(key)).toHaveLength(1);
    }
    const entries = await schema.db
      .select()
      .from(schema.changeSetEntry)
      .where(eq(schema.changeSetEntry.changeSetId, result.changeSetId ?? ''));
    expect(entries).toHaveLength(3);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, base.orgId)),
    ).toHaveLength(1);
  });
});
