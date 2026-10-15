import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import {
  inheritOrdinaryPreparationContext,
  prospectiveWorkReference,
  createOrdinaryPreparationContext,
} from '../../src/lib/work-creation/ordinary-prospective';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import type { ResolvedRootDraft } from '@docket/work/blueprints';
import type { OrdinaryWorkCommand } from '../../src/lib/work-creation/types';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { getDb, seedTaskAccessOrg, seedUserWithHub, one } from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const now = new Date('2026-10-15T01:30:00Z');
async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const command: OrdinaryWorkCommand = {
    caller: {
      orgId: base.orgId,
      actorId: base.humanActorId,
      roleId: null,
      capabilities: ['manage'],
    },
    kind: 'project',
    body: { name: 'Event' },
    invocation: { origin: originFor('work_create', {}, appProvenance()) },
  };
  const root: ResolvedRootDraft = {
    kind: 'project',
    fields: { name: 'Event' },
    teamId: null,
    responsibleActorId: null,
    cycleId: null,
    dates: {},
  };
  return { ...base, command, root };
}
async function load(command: OrdinaryWorkCommand, root: ResolvedRootDraft) {
  const { loadBlueprintCreationContext } =
    await import('../../src/lib/work-template-blueprints/context');
  return schema.db.transaction((tx) => loadBlueprintCreationContext(tx, command, root, now));
}

describe('transaction-owned blueprint context snapshots', () => {
  it('freezes the actual creator Hub timezone, civil day and workspace weekdays without selecting an arbitrary team', async () => {
    const f = await fixture();
    const userId = await seedUserWithHub(schema.db, schema, 'Creator');
    await schema.db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, f.humanActorId));
    await schema.db
      .update(schema.hub)
      .set({ preferences: { timezone: 'America/Los_Angeles' } })
      .where(eq(schema.hub.userId, userId));
    await schema.db
      .update(schema.organization)
      .set({ workingWeekdays: [2, 3, 4, 5, 6] })
      .where(eq(schema.organization.id, f.orgId));
    const context = await load(f.command, f.root);
    expect(context).toMatchObject({
      timezone: 'America/Los_Angeles',
      creationDate: '2026-10-14',
      workingWeekdays: [2, 3, 4, 5, 6],
      creationTeamId: null,
      visibility: 'public',
    });
    expect(context.actors).toContainEqual({ id: f.humanActorId, active: true });
    expect(context).not.toHaveProperty('runDate');
    expect(context.overrides).toBeUndefined();
  });
  it('uses only the oldest active registered default Athena and flags an inactive parent responsible', async () => {
    const f = await fixture();
    const inactive = one(
      await schema.db
        .insert(schema.actor)
        .values({
          organizationId: f.orgId,
          kind: 'human',
          displayName: 'Inactive parent',
          status: 'suspended',
        })
        .returning(),
    );
    const unregistered = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'agent', displayName: 'Athena' })
        .returning(),
    );
    const registered = [];
    for (const [index, archived] of [true, false, false].entries()) {
      const actor = one(
        await schema.db
          .insert(schema.actor)
          .values({
            organizationId: f.orgId,
            kind: 'agent',
            displayName: 'Athena',
            archivedAt: archived ? now : null,
          })
          .returning(),
      );
      await schema.db.insert(schema.agent).values({
        organizationId: f.orgId,
        actorId: actor.id,
        createdAt: new Date(2026, 0, index + 1),
      });
      registered.push(actor.id);
    }
    const context = await load(f.command, {
      ...f.root,
      responsibleActorId: ActorId.parse(inactive.id),
    });
    expect(context.athenaActorId).toBe(registered[1]);
    expect(context.actors).toContainEqual({ id: inactive.id, active: false });
    expect(context.actors.some((actor) => actor.id === unregistered.id)).toBe(false);
  });
  it('freezes only relevant team cycles with UTC civil bounds, inclusive end and completed/archived flags', async () => {
    const f = await fixture();
    await schema.db.insert(schema.cycle).values([
      {
        organizationId: f.orgId,
        teamId: f.teamId,
        number: 1,
        startsAt: new Date('2026-10-01T23:00:00Z'),
        endsAt: new Date('2026-10-15T00:00:00Z'),
        status: 'active',
      },
      {
        organizationId: f.orgId,
        teamId: f.teamId,
        number: 2,
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-10T00:00:00Z'),
        status: 'completed',
      },
      {
        organizationId: f.orgId,
        teamId: f.teamId,
        number: 3,
        startsAt: new Date('2026-08-01T00:00:00Z'),
        endsAt: new Date('2026-08-10T00:00:00Z'),
        archivedAt: now,
      },
    ]);
    const context = await load(
      { ...f.command, blueprint: { creationTeamId: TeamId.parse(f.teamId), optionalChoices: [] } },
      f.root,
    );
    expect(context.cycles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: f.teamId,
          startDate: '2026-10-01',
          endDate: '2026-10-15',
          closed: false,
          archived: false,
        }),
        expect.objectContaining({ closed: true }),
        expect.objectContaining({ archived: true }),
      ]),
    );
    expect(context.cycles).toHaveLength(3);
    expect((await load(f.command, f.root)).cycles).toHaveLength(0);
  });
  it('refuses foreign and archived explicit creation teams before exposing their metadata', async () => {
    const f = await fixture();
    const foreign = await fixture();
    await expect(
      load(
        {
          ...f.command,
          blueprint: { creationTeamId: TeamId.parse(foreign.teamId), optionalChoices: [] },
        },
        f.root,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await schema.db
      .update(schema.team)
      .set({ archivedAt: now })
      .where(eq(schema.team.id, f.teamId));
    await expect(
      load(
        {
          ...f.command,
          blueprint: { creationTeamId: TeamId.parse(f.teamId), optionalChoices: [] },
        },
        f.root,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('retains private ancestor scope and requires live contribute access for external placement', async () => {
    const f = await fixture();
    const program = one(
      await schema.db
        .insert(schema.program)
        .values({
          organizationId: f.orgId,
          name: 'Private operations',
          statusId: f.statusId('program', 'active'),
          visibility: 'private',
        })
        .returning(),
    );
    const project = one(
      await schema.db
        .insert(schema.project)
        .values({
          organizationId: f.orgId,
          name: 'Public override',
          statusId: f.statusId('project', 'planned'),
          programId: program.id,
          visibility: 'public',
        })
        .returning(),
    );
    const root = { ...f.root, placement: { projectId: project.id } };
    expect((await load(f.command, root)).visibility).toBe('private');
    await schema.db.delete(schema.grant).where(eq(schema.grant.subjectId, f.humanActorId));
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'project',
      resourceId: project.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
    });
    await expect(load(f.command, root)).rejects.toBeDefined();
  });
  it('keeps an explicitly private root private and falls back to UTC when creator has no Hub', async () => {
    const f = await fixture();
    const root: ResolvedRootDraft = {
      ...f.root,
      kind: 'program',
      fields: { name: 'Private', visibility: 'private' },
    };
    const command: OrdinaryWorkCommand = {
      ...f.command,
      kind: 'program',
      body: { name: 'Private', visibility: 'private' },
    };
    expect(await load(command, root)).toMatchObject({
      visibility: 'private',
      timezone: 'UTC',
      creationDate: '2026-10-15',
      athenaActorId: null,
    });
  });
  it('refuses explicit creation teams hidden from a live guest despite forged caller capabilities', async () => {
    const f = await fixture();
    const guest = one(
      await schema.db
        .insert(schema.role)
        .values({
          organizationId: f.orgId,
          name: 'Guest',
          key: 'guest',
          capabilities: [],
          defaultVisibility: 'private',
        })
        .returning(),
    );
    await schema.db
      .update(schema.actor)
      .set({ roleId: guest.id })
      .where(eq(schema.actor.id, f.humanActorId));
    await schema.db.delete(schema.grant).where(eq(schema.grant.subjectId, f.humanActorId));
    await expect(
      load(
        {
          ...f.command,
          blueprint: { creationTeamId: TeamId.parse(f.teamId), optionalChoices: [] },
        },
        f.root,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('refuses a foreign parent placement and does not expose its private name', async () => {
    const f = await fixture();
    const other = await fixture();
    const foreign = one(
      await schema.db
        .insert(schema.program)
        .values({
          organizationId: other.orgId,
          name: 'Never expose this private name',
          statusId: other.statusId('program', 'active'),
          visibility: 'private',
        })
        .returning(),
    );
    await expect(
      load(f.command, { ...f.root, placement: { programId: foreign.id } }),
    ).rejects.toMatchObject({ status: 404, message: 'Placement not found' });
  });
  it('supports body creation choices and a resolved root team without selecting any other workspace team', async () => {
    const f = await fixture();
    const body = {
      ...f.command.body,
      blueprint: { creationTeamId: TeamId.parse(f.teamId), optionalChoices: [] },
    };
    expect((await load({ ...f.command, body }, f.root)).creationTeamId).toBe(f.teamId);
    expect(
      (await load(f.command, { ...f.root, teamId: TeamId.parse(f.teamId) })).creationTeamId,
    ).toBe(f.teamId);
  });
  it('preserves nullable initiating actors in a trusted internal snapshot without inventing a person or timezone', async () => {
    const f = await fixture();
    const command: OrdinaryWorkCommand = {
      ...f.command,
      caller: {
        kind: 'retained-recurrence',
        orgId: f.orgId,
        actorId: null,
        binding: { seriesId: 'checked-by-mutation-owner', revisionId: 'checked-by-mutation-owner' },
        proof: {},
      },
    };
    const context = await load(command, f.root);
    expect(context).toMatchObject({
      initiatingActorId: null,
      actors: [],
      athenaActorId: null,
      timezone: 'UTC',
    });
  });
  it('reads exact transaction-authorized prospective parent scope before physical insertion', async () => {
    const f = await fixture();
    const id = schema.genId();
    await schema.db.transaction(async (tx) => {
      const prepared = await createOrdinaryPreparationContext(
        tx,
        f.command,
        [{ id, orgId: f.orgId, kind: 'program', visibility: 'private' }],
        'private',
      );
      const { loadBlueprintCreationContext } =
        await import('../../src/lib/work-template-blueprints/context');
      const context = await loadBlueprintCreationContext(
        tx,
        f.command,
        { ...f.root, placement: { programId: id } },
        now,
        prepared,
      );
      expect(context.visibility).toBe('private');
      await expect(
        loadBlueprintCreationContext(
          tx,
          f.command,
          { ...f.root, placement: { programId: id } },
          now,
          { ...prepared, proof: {} },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
  it('refuses a prospective authority reused from a different transaction', async () => {
    const f = await fixture();
    const id = schema.genId();
    const prepared = await schema.db.transaction((tx) =>
      createOrdinaryPreparationContext(
        tx,
        f.command,
        [{ id, orgId: f.orgId, kind: 'program', visibility: 'private' }],
        'private',
      ),
    );
    const { loadBlueprintCreationContext } =
      await import('../../src/lib/work-template-blueprints/context');
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintCreationContext(
          tx,
          f.command,
          { ...f.root, placement: { programId: id } },
          now,
          prepared,
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('inherits exact checked public parent references without widening the private child context', async () => {
    const f = await fixture();
    const parentId = schema.genId();
    const childId = schema.genId();
    await schema.db.transaction(async (tx) => {
      const parent = await createOrdinaryPreparationContext(
        tx,
        f.command,
        [{ id: parentId, orgId: f.orgId, kind: 'project', visibility: 'public' }],
        'public',
      );
      const child = await createOrdinaryPreparationContext(
        tx,
        f.command,
        [{ id: childId, orgId: f.orgId, kind: 'task', visibility: 'private' }],
        'private',
      );
      inheritOrdinaryPreparationContext(tx, f.command, child, parent);
      expect(prospectiveWorkReference(tx, f.command, child, 'project', parentId)).toMatchObject({
        id: parentId,
        visibility: 'public',
      });
      expect(prospectiveWorkReference(tx, f.command, child, 'task', childId)).toMatchObject({
        id: childId,
        visibility: 'private',
      });
      expect(() => {
        inheritOrdinaryPreparationContext(tx, f.command, parent, child);
      }).toThrow();
      const { loadBlueprintCreationContext } =
        await import('../../src/lib/work-template-blueprints/context');
      expect(
        (
          await loadBlueprintCreationContext(
            tx,
            f.command,
            { ...f.root, placement: { projectId: parentId } },
            now,
            child,
          )
        ).visibility,
      ).toBe('private');
      await expect(
        loadBlueprintCreationContext(tx, f.command, f.root, now, { ...child, proof: {} }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});
