import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { NotFoundError } from '../../src/error';
import { loadBlueprintSnapshot } from '../../src/lib/work-template-blueprints/snapshot';
import {
  getDb,
  one,
  seedProject,
  seedTask,
  seedTaskAccessOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'contribute');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['contribute'],
  };
  const root = await seedProject(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    name: 'Community dinner',
    description: '## Authored outline',
    summary: null,
    teamId: base.teamId,
    status: 'planned',
    targetDate: new Date('2026-11-20'),
    createdBy: base.humanActorId,
  });
  const checkpoint = one(
    await schema.db
      .insert(schema.milestone)
      .values({
        organizationId: base.orgId,
        projectId: root.id,
        name: 'Venue',
        targetDate: new Date('2026-11-18'),
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  const task = await seedTask(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    teamId: base.teamId,
    title: 'Confirm venue',
    description: 'Edited task body',
    projectId: root.id,
    milestoneId: checkpoint.id,
    assigneeId: base.humanActorId,
    dueDate: new Date('2026-11-17'),
    state: 'todo',
    createdBy: base.humanActorId,
  });
  const nested = await seedTask(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    teamId: base.teamId,
    title: 'Send confirmation',
    projectId: root.id,
    milestoneId: checkpoint.id,
    parentTaskId: task.id,
    state: 'todo',
    createdBy: base.humanActorId,
  });
  return { ...base, caller, root, checkpoint, task, nested };
}

describe('authorized concrete blueprint snapshots', () => {
  it('reads authored and manual work with current physical parents and civil dates', async () => {
    const f = await fixture();
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
    );
    expect(snapshot.root).toMatchObject({
      id: f.root.id,
      kind: 'project',
      fields: { description: '## Authored outline', summary: null },
      dates: { targetDate: '2026-11-20' },
    });
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.nodes.find((node) => node.id === f.task.id)).toMatchObject({
      parentId: f.checkpoint.id,
      fields: { description: 'Edited task body' },
      dates: { dueDate: '2026-11-17' },
      sourceStepId: null,
    });
    expect(snapshot.nodes.find((node) => node.id === f.nested.id)).toMatchObject({
      parentId: f.task.id,
    });
    expect(snapshot.rowsByRef.get(`task:${f.task.id}`)).toMatchObject({
      kind: 'task',
      row: { projectId: f.root.id, milestoneId: f.checkpoint.id },
    });
  });

  it('refuses foreign roots without returning work prose', async () => {
    const f = await fixture();
    const foreign = await seedTaskAccessOrg(schema.db, schema, 'contribute');
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(
          tx,
          { ...f.caller, orgId: foreign.orgId, actorId: foreign.humanActorId },
          { kind: 'project', id: f.root.id },
          { scope: 'tree' },
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fails closed for a hidden required descendant rather than copying its body', async () => {
    const f = await fixture();
    // The default harness grants organization-wide access, including private descendants.
    // Use public baseline read access here so this child is actually hidden.
    await schema.db
      .delete(schema.grant)
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'PRIVATE CHILD TITLE',
      description: 'PRIVATE CHILD BODY',
      projectId: f.root.id,
      state: 'todo',
      visibility: 'private',
    });
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses oversized capture instead of returning a truncated tree', async () => {
    const f = await fixture();
    await schema.db.insert(schema.task).values(
      Array.from({ length: 497 }, (_, index) => ({
        organizationId: f.orgId,
        teamId: f.teamId,
        projectId: f.root.id,
        title: `Manual ${index}`,
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })),
    );
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
      ),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
  });
  it('reads a standalone checkpoint through its actual Project without inventing a team, owner or completion', async () => {
    const f = await fixture();
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(
        tx,
        f.caller,
        { kind: 'milestone', id: f.checkpoint.id },
        { scope: 'reference' },
      ),
    );
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.root).toMatchObject({
      kind: 'milestone',
      fields: { name: 'Venue', description: '' },
      teamId: null,
      responsibleActorId: null,
      cycleId: null,
      state: 'unstarted',
      workTypeId: null,
    });
    expect(snapshot.context).toMatchObject({ creationTeamId: null, cycles: [], completions: [] });
  });
  it.each(['initiative', 'program'] as const)(
    'captures a %s reference with its own nullable prose and scope',
    async (kind) => {
      const f = await fixture();
      const values = {
        organizationId: f.orgId,
        name: 'Operations',
        description: null,
        ownerId: f.humanActorId,
        statusId: f.statusId(kind, 'active'),
      };
      const root =
        kind === 'initiative'
          ? one(
              await schema.db
                .insert(schema.initiative)
                .values({ ...values, leadTeamId: f.teamId })
                .returning(),
            )
          : one(
              await schema.db
                .insert(schema.program)
                .values({ ...values, visibility: 'private' })
                .returning(),
            );
      const snapshot = await schema.db.transaction((tx) =>
        loadBlueprintSnapshot(tx, f.caller, { kind, id: root.id }, { scope: 'reference' }),
      );
      expect(snapshot.root).toMatchObject({
        kind,
        fields: { name: 'Operations', description: '' },
        responsibleActorId: f.humanActorId,
        cycleId: null,
      });
      expect(snapshot.root.teamId).toBe(kind === 'initiative' ? f.teamId : null);
      expect(snapshot.context.completions).toEqual([]);
      if (kind === 'program') {
        expect(snapshot.root.fields).toMatchObject({ visibility: 'private' });
        await expect(
          schema.db.transaction((tx) =>
            loadBlueprintSnapshot(
              tx,
              f.caller,
              { kind, id: root.id },
              { scope: 'reference', access: 'edit' },
            ),
          ),
        ).rejects.toMatchObject({ status: 403 });
      }
    },
  );
  it.each(['completed', 'canceled'] as const)(
    'keeps a %s task completion separate from its UTC civil dates and effort',
    async (state) => {
      const f = await fixture();
      const instant = new Date('2026-10-15T01:30:00Z');
      const userId = await seedUserWithHub(schema.db, schema, 'West coast creator');
      await schema.db
        .update(schema.actor)
        .set({ userId })
        .where(eq(schema.actor.id, f.humanActorId));
      await schema.db
        .update(schema.hub)
        .set({ preferences: { timezone: 'America/Los_Angeles' } })
        .where(eq(schema.hub.userId, userId));
      await schema.db
        .update(schema.task)
        .set({
          state: state === 'completed' ? 'done' : state,
          statusId: f.statusId('task', state === 'completed' ? 'done' : state),
          estimate: 3,
          description: null,
          ...(state === 'completed' ? { completedAt: instant } : { canceledAt: instant }),
        })
        .where(eq(schema.task.id, f.task.id));
      const snapshot = await schema.db.transaction((tx) =>
        loadBlueprintSnapshot(
          tx,
          f.caller,
          { kind: 'task', id: f.task.id },
          { scope: 'reference', now: instant },
        ),
      );
      expect(snapshot.root).toMatchObject({
        state,
        fields: { description: '', estimate: 3 },
        dates: { dueDate: '2026-11-17' },
      });
      expect(snapshot.context).toMatchObject({
        timezone: 'America/Los_Angeles',
        creationDate: '2026-10-14',
        completions: [
          {
            id: f.task.id,
            path: [],
            state,
            completedAt: state === 'completed' ? instant.toISOString() : null,
          },
        ],
      });
    },
  );
  it.each(['suspended', 'archived'] as const)(
    'refuses %s live authority before returning a captured body',
    async (state) => {
      const f = await fixture();
      await schema.db
        .update(schema.actor)
        .set(state === 'suspended' ? { status: 'suspended' } : { archivedAt: new Date() })
        .where(eq(schema.actor.id, f.humanActorId));
      await expect(
        schema.db.transaction((tx) =>
          loadBlueprintSnapshot(
            tx,
            f.caller,
            { kind: 'project', id: f.root.id },
            { scope: 'reference' },
          ),
        ),
      ).rejects.toMatchObject({ status: 404, message: 'Work not found' });
    },
  );
  it('keeps view-only capture available but refuses edit after the current grant is downgraded', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(
        tx,
        f.caller,
        { kind: 'project', id: f.root.id },
        { scope: 'reference' },
      ),
    );
    expect(snapshot.root.fields.description).toBe('## Authored outline');
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(
          tx,
          f.caller,
          { kind: 'project', id: f.root.id },
          { scope: 'reference', access: 'edit' },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('falls back to UTC for a legacy invalid Hub timezone without altering stored date-only coordinates', async () => {
    const f = await fixture();
    const userId = await seedUserWithHub(schema.db, schema, 'Legacy zone');
    await schema.db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, f.humanActorId));
    await schema.db
      .update(schema.hub)
      .set({ preferences: { timezone: 'Unrecognized/Zone' } })
      .where(eq(schema.hub.userId, userId));
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(
        tx,
        f.caller,
        { kind: 'project', id: f.root.id },
        { scope: 'reference', now: new Date('2026-10-15T01:30:00Z') },
      ),
    );
    expect(snapshot.context).toMatchObject({ timezone: 'UTC', creationDate: '2026-10-15' });
    expect(snapshot.root.dates.targetDate).toBe('2026-11-20');
  });
});
