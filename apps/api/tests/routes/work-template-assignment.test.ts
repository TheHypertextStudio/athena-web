import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';
import { workTemplateAssignmentRoutes } from '../../src/routes/work-template-assignment';
import identities from '../../src/routes/work-template-identities';

type Kind = 'task' | 'project' | 'initiative' | 'program';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };

async function fixture(kind: Kind = 'project', visibility: 'public' | 'private' = 'public') {
  const seeded = await seedTaskAccessOrg(
    schema.db,
    schema,
    kind === 'program' ? 'manage' : 'contribute',
  );
  const common = { organizationId: seeded.orgId, description: 'My manually written notes' };
  const targetDate = new Date('2027-02-03T00:00:00.000Z');
  const rows =
    kind === 'task'
      ? await schema.db
          .insert(schema.task)
          .values({
            ...common,
            title: 'Mine',
            teamId: seeded.teamId,
            state: 'todo',
            statusId: seeded.statusId('task', 'todo'),
            dueDate: targetDate,
            visibility,
          })
          .returning()
      : kind === 'project'
        ? await schema.db
            .insert(schema.project)
            .values({
              ...common,
              name: 'Mine',
              teamId: seeded.teamId,
              statusId: seeded.statusId('project', 'planned'),
              targetDate,
              visibility,
            })
            .returning()
        : kind === 'initiative'
          ? await schema.db
              .insert(schema.initiative)
              .values({
                ...common,
                name: 'Mine',
                leadTeamId: seeded.teamId,
                statusId: seeded.statusId('initiative', 'active'),
                targetDate,
              })
              .returning()
          : await schema.db
              .insert(schema.program)
              .values({
                ...common,
                name: 'Mine',
                statusId: seeded.statusId('program', 'active'),
                visibility,
              })
              .returning();
  const row = rows[0];
  if (!row) throw new Error('Missing work fixture');
  const app = appWithActor(
    workTemplateAssignmentRoutes(kind),
    seeded.orgId,
    ['manage'],
    seeded.humanActorId,
  );
  return { ...seeded, row, app, kind };
}

async function publication(orgId: string, kind: Kind = 'project') {
  const definition = WorkTemplateDefinition.parse({
    name: 'Event',
    payload: { targetType: kind, description: 'Replaceable outline' },
  });
  const [row] = await schema.db
    .insert(schema.template)
    .values({
      organizationId: orgId,
      targetType: kind,
      name: definition.name,
      scope: 'organization',
      payload: definition.payload,
      draftDefinition: definition,
    })
    .returning();
  if (!row) throw new Error('Missing template');
  const [version] = await schema.db
    .insert(schema.workTypeVersion)
    .values({ organizationId: orgId, workTypeId: row.id, number: 1, definition })
    .returning();
  if (!version) throw new Error('Missing version');
  await schema.db
    .update(schema.template)
    .set({ publicationState: 'published', latestPublishedVersionId: version.id })
    .where(eq(schema.template.id, row.id));
  return { workTypeId: row.id, workTypeVersionId: version.id };
}

async function assign(f: Awaited<ReturnType<typeof fixture>>, json: object) {
  return f.app.request(`/${f.row.id}/template`, {
    method: 'POST',
    headers,
    body: JSON.stringify(json),
  });
}

async function persisted(f: Awaited<ReturnType<typeof fixture>>) {
  const table = schema[f.kind];
  return (await schema.db.select().from(table).where(eq(table.id, f.row.id)))[0];
}

describe('existing work template assignment', () => {
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'changes only the %s identity, preserving manual prose, dates and children',
    async (kind) => {
      const f = await fixture(kind);
      const child = await schema.db
        .insert(schema.task)
        .values({
          organizationId: f.orgId,
          teamId: f.teamId,
          title: 'Child',
          state: 'todo',
          statusId: f.statusId('task', 'todo'),
          ...(kind === 'task'
            ? { parentTaskId: f.row.id }
            : kind === 'project'
              ? { projectId: f.row.id }
              : kind === 'program'
                ? { programId: f.row.id }
                : {}),
        })
        .returning();
      const selection = await publication(f.orgId, kind);
      const response = await assign(f, selection);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ...selection,
        workTypeAssignmentSource: 'changed',
      });
      const after = await persisted(f);
      expect(after).toMatchObject({ description: f.row.description, ...selection });
      if ('dueDate' in f.row) expect(after).toHaveProperty('dueDate', f.row.dueDate);
      if ('targetDate' in f.row) expect(after).toHaveProperty('targetDate', f.row.targetDate);
      expect(
        await schema.db
          .select()
          .from(schema.task)
          .where(eq(schema.task.id, child[0]?.id ?? '')),
      ).toEqual(child);
    },
  );

  it('uses live target grants, hides inaccessible private work, and ignores stale middleware privileges', async () => {
    const f = await fixture('project', 'private');
    const selection = await publication(f.orgId);
    await schema.db.delete(schema.grant).where(eq(schema.grant.organizationId, f.orgId));
    expect((await assign(f, selection)).status).toBe(404);
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'project',
      resourceId: f.row.id,
      capabilities: ['view'],
    });
    expect((await assign(f, selection)).status).toBe(403);
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(eq(schema.grant.resourceId, f.row.id));
    expect((await assign(f, selection)).status).toBe(200);
  });

  it('requires manage for Programs and permits using publications under admin-only authoring', async () => {
    const f = await fixture('program');
    const selection = await publication(f.orgId, 'program');
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(eq(schema.grant.organizationId, f.orgId));
    expect((await assign(f, selection)).status).toBe(403);
    const project = await fixture();
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, project.orgId));
    expect((await assign(project, await publication(project.orgId))).status).toBe(200);
  });

  it('rejects foreign, wrong-kind, unpublished, archived, mismatched and unavailable team selections without changes', async () => {
    const f = await fixture();
    const own = await publication(f.orgId);
    const foreign = await publication((await fixture()).orgId);
    const wrongKind = await publication(f.orgId, 'task');
    for (const selection of [
      foreign,
      wrongKind,
      { ...own, workTypeVersionId: foreign.workTypeVersionId },
    ])
      expect((await assign(f, selection)).status).toBe(404);
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, own.workTypeId));
    expect((await assign(f, own)).status).toBe(404);
    const [draft] = await schema.db
      .insert(schema.template)
      .values({
        organizationId: f.orgId,
        name: 'Private',
        targetType: 'project',
        ownerActorId: f.humanActorId,
        payload: { targetType: 'project' },
      })
      .returning();
    expect((await assign(f, { workTypeId: draft?.id })).status).toBe(404);
    const offered = await publication(f.orgId);
    const [team] = await schema.db
      .insert(schema.team)
      .values({ organizationId: f.orgId, key: 'OTHER', name: 'Other' })
      .returning();
    if (!team) throw new Error('Missing offering team');
    await schema.db
      .insert(schema.workTypeTeam)
      .values({ organizationId: f.orgId, workTypeId: offered.workTypeId, teamId: team.id });
    expect((await assign(f, offered)).status).toBe(422);
    expect(await persisted(f)).toEqual(f.row);
  });

  it('rejects revoked actors and foreign work before resolving a template', async () => {
    const own = await fixture();
    const foreign = await fixture();
    const selection = await publication(own.orgId);
    const outsider = appWithActor(
      workTemplateAssignmentRoutes('project'),
      own.orgId,
      ['manage'],
      own.humanActorId,
    );
    expect(
      (
        await outsider.request(`/${foreign.row.id}/template`, {
          method: 'POST',
          headers,
          body: JSON.stringify(selection),
        })
      ).status,
    ).toBe(404);
    await schema.db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, own.humanActorId));
    expect((await assign(own, selection)).status).toBe(404);
    expect(await persisted(own)).toEqual(own.row);
  });

  it('refuses body/date updates and version-only selections on the identity endpoint', async () => {
    const f = await fixture();
    const selection = await publication(f.orgId);
    expect((await assign(f, { ...selection, description: 'Lost notes' })).status).toBe(422);
    expect((await assign(f, { workTypeVersionId: selection.workTypeVersionId })).status).toBe(422);
    expect(await persisted(f)).toEqual(f.row);
  });
});

describe('bounded template identity metadata', () => {
  it('paginates all offered identities without silently truncating the catalog', async () => {
    const f = await fixture();
    await publication(f.orgId);
    await publication(f.orgId);
    const app = appWithActor(identities, f.orgId, ['view'], f.humanActorId);
    const first = (await (await app.request('/identities?targetType=project&limit=1')).json()) as {
      items: { id: string }[];
      nextCursor?: string;
    };
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = (await (
      await app.request(`/identities?targetType=project&limit=1&cursor=${first.nextCursor ?? ''}`)
    ).json()) as { items: { id: string }[] };
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it('keeps the pinned publication name while reporting a newer version and filters choices by team', async () => {
    const f = await fixture();
    const selection = await publication(f.orgId);
    const definition = WorkTemplateDefinition.parse({
      name: 'Revised event',
      payload: {
        targetType: 'project',
        description: 'Private starting outline is absent from metadata',
      },
    });
    const [next] = await schema.db
      .insert(schema.workTypeVersion)
      .values({ organizationId: f.orgId, workTypeId: selection.workTypeId, number: 2, definition })
      .returning();
    if (!next) throw new Error('Missing publication');
    await schema.db
      .update(schema.template)
      .set({
        latestPublishedVersionId: next.id,
        name: definition.name,
        description: definition.description,
        icon: definition.icon,
        payload: definition.payload,
      })
      .where(eq(schema.template.id, selection.workTypeId));
    await schema.db
      .insert(schema.workTypeTeam)
      .values({ organizationId: f.orgId, workTypeId: selection.workTypeId, teamId: f.teamId });
    const app = appWithActor(identities, f.orgId, ['view'], f.humanActorId);
    const display = await app.request(
      `/${selection.workTypeId}/identity/${selection.workTypeVersionId}`,
    );
    expect(await display.json()).toMatchObject({
      name: 'Event',
      versionNumber: 1,
      latestVersionNumber: 2,
    });
    const hiddenChoice = await app.request('/identities?targetType=project');
    expect(JSON.stringify(await hiddenChoice.json())).not.toContain(selection.workTypeId);
    const offeredChoice = await app.request(`/identities?targetType=project&teamId=${f.teamId}`);
    const choices = (await offeredChoice.json()) as { items: Record<string, unknown>[] };
    expect(choices.items.find((item) => item['id'] === selection.workTypeId)).toEqual({
      id: selection.workTypeId,
      name: 'Revised event',
      icon: null,
      isBase: false,
      archived: false,
      versionNumber: 2,
      latestVersionNumber: 2,
      versionId: next.id,
    });
    expect(JSON.stringify(choices)).not.toContain('starting outline');
  });

  it('returns pinned display only, keeps archived identity readable, and excludes drafts and foreign versions', async () => {
    const f = await fixture();
    const own = await publication(f.orgId);
    const foreign = await publication((await fixture()).orgId);
    const app = appWithActor(identities, f.orgId, ['view'], f.humanActorId);
    const path = `/${own.workTypeId}/identity/${own.workTypeVersionId}`;
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: own.workTypeId,
      name: 'Event',
      icon: null,
      isBase: false,
      archived: false,
      versionNumber: 1,
      latestVersionNumber: 1,
    });
    expect(
      (await app.request(`/${own.workTypeId}/identity/${foreign.workTypeVersionId}`)).status,
    ).toBe(404);
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(
        and(eq(schema.template.id, own.workTypeId), eq(schema.template.organizationId, f.orgId)),
      );
    expect((await app.request(path)).status).toBe(200);
    const choices = await app.request('/identities?targetType=project');
    expect(choices.status).toBe(200);
    expect(JSON.stringify(await choices.json())).not.toContain(own.workTypeId);
  });
});
