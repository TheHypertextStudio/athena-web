import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { appWithAuthenticatedActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';
import {
  prepareWorkTemplateCreation,
  prepareBlueprintChildTemplateCreation,
} from '../../src/lib/work-template-creation';
import { ProjectCreate } from '../../src/contracts/project';

let schema: typeof DbModule;
let db: typeof DbModule.db;
beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function published(
  kind: 'task' | 'project' | 'initiative' | 'program',
  startingFields: Readonly<Record<string, unknown>> = {},
) {
  const workspace = await seedTaskAccessOrg(db, schema, 'manage');
  const definition = WorkTemplateDefinition.parse({
    name: 'Event',
    payload: {
      targetType: kind,
      description: '## Preparation\n\n## Event',
      ...(kind === 'task' ? { priority: 'high' } : { status: 'obsolete-status' }),
      ...startingFields,
    },
  });
  const [row] = await db
    .insert(schema.template)
    .values({
      organizationId: workspace.orgId,
      targetType: kind,
      name: definition.name,
      scope: 'organization',
      payload: definition.payload,
      draftDefinition: definition,
    })
    .returning();
  if (!row) throw new Error('Missing test definition');
  const [version] = await db
    .insert(schema.workTypeVersion)
    .values({ organizationId: workspace.orgId, workTypeId: row.id, number: 1, definition })
    .returning();
  if (!version) throw new Error('Missing test publication');
  await db
    .update(schema.template)
    .set({ publicationState: 'published', latestPublishedVersionId: version.id })
    .where(eq(schema.template.id, row.id));
  return { ...workspace, templateId: row.id, versionId: version.id };
}

describe('published work-template creation', () => {
  it('retains a reviewed nested publication outside its menu offerings and after archive', async () => {
    const fixture = await published('task');
    await db.insert(schema.workTypeTeam).values({
      organizationId: fixture.orgId,
      workTypeId: fixture.templateId,
      teamId: fixture.teamId,
    });
    const selection = { workTypeId: fixture.templateId, workTypeVersionId: fixture.versionId };
    await expect(
      prepareWorkTemplateCreation(fixture.orgId, 'task', selection),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      prepareBlueprintChildTemplateCreation(fixture.orgId, 'task', selection),
    ).resolves.toMatchObject({ ...selection, description: '## Preparation\n\n## Event' });
    await db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, fixture.templateId));
    await expect(
      prepareWorkTemplateCreation(fixture.orgId, 'task', selection),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      prepareBlueprintChildTemplateCreation(fixture.orgId, 'task', selection),
    ).resolves.toMatchObject({ ...selection, description: '## Preparation\n\n## Event' });
  });

  it('requires an exact reviewed publication for the internal child adapter', async () => {
    const fixture = await published('task');
    await expect(
      prepareBlueprintChildTemplateCreation(fixture.orgId, 'task', {
        workTypeId: fixture.templateId,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('retains a canonical Task starting state while explicit state still wins', async () => {
    const fixture = await published('task', { state: 'in_progress' });
    const prepared = await prepareWorkTemplateCreation(fixture.orgId, 'task', {
      teamId: fixture.teamId,
      workTypeId: fixture.templateId,
    });
    expect(prepared.state).toBe('in_progress');
    const explicit = await prepareWorkTemplateCreation(fixture.orgId, 'task', {
      teamId: fixture.teamId,
      workTypeId: fixture.templateId,
      state: 'backlog',
    });
    expect(explicit.state).toBe('backlog');
  });

  it('retains project identity and rejects a version alone in the wire contract', () => {
    const workTypeId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const workTypeVersionId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    expect(ProjectCreate.parse({ name: 'Dinner', workTypeId, workTypeVersionId })).toMatchObject({
      workTypeId,
      workTypeVersionId,
    });
    expect(ProjectCreate.safeParse({ name: 'Dinner', workTypeVersionId }).success).toBe(false);
  });

  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'applies a %s publication while explicit prose wins and retired status defaults fall back',
    async (kind) => {
      const fixture = await published(kind);
      const prepared = await prepareWorkTemplateCreation(fixture.orgId, kind, {
        name: 'Dinner',
        title: 'Prepare dinner',
        teamId: fixture.teamId,
        workTypeId: fixture.templateId,
      });
      expect(prepared).toMatchObject({
        description: '## Preparation\n\n## Event',
        workTypeId: fixture.templateId,
        workTypeVersionId: fixture.versionId,
      });
      expect(prepared).not.toHaveProperty('status', 'obsolete-status');
      const explicit = await prepareWorkTemplateCreation(fixture.orgId, kind, {
        title: 'Mine',
        name: 'Mine',
        teamId: fixture.teamId,
        workTypeId: fixture.templateId,
        description: '',
      });
      expect(explicit.description).toBe('');
    },
  );

  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'creates and reopens %s work with its chosen publication and deliberately cleared body',
    async (kind) => {
      const fixture = await published(kind);
      const router =
        kind === 'task'
          ? (await import('../../src/routes/tasks')).default
          : kind === 'project'
            ? (await import('../../src/routes/projects')).default
            : kind === 'initiative'
              ? (await import('../../src/routes/initiatives')).default
              : (await import('../../src/routes/programs')).default;
      const app = await appWithAuthenticatedActor(
        db,
        schema,
        router,
        fixture.orgId,
        ['manage'],
        fixture.humanActorId,
      );
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Prepare dinner',
          name: 'Dinner',
          ...(kind === 'task' ? { teamId: fixture.teamId } : {}),
          workTypeId: fixture.templateId,
          workTypeVersionId: fixture.versionId,
          description: '',
        }),
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as {
        id: string;
        workTypeId: string;
        workTypeVersionId: string;
        description: string;
      };
      expect(created).toMatchObject({
        workTypeId: fixture.templateId,
        workTypeVersionId: fixture.versionId,
        description: '',
      });
      const reopened = await app.request(`/${created.id}`);
      expect(reopened.status).toBe(200);
      expect(await reopened.json()).toMatchObject({
        workTypeId: fixture.templateId,
        workTypeVersionId: fixture.versionId,
        description: '',
      });
    },
  );

  it('hides foreign, unpublished, archived and wrong-kind definitions', async () => {
    const own = await published('project');
    const foreign = await published('project');
    for (const [orgId, kind, id] of [
      [own.orgId, 'project', foreign.templateId],
      [own.orgId, 'task', own.templateId],
    ] as const) {
      await expect(
        prepareWorkTemplateCreation(orgId, kind, { workTypeId: id }),
      ).rejects.toMatchObject({ status: 404 });
    }
    await db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, own.templateId));
    await expect(
      prepareWorkTemplateCreation(own.orgId, 'project', { workTypeId: own.templateId }),
    ).rejects.toMatchObject({ status: 404 });
    const [draft] = await db
      .insert(schema.template)
      .values({
        organizationId: own.orgId,
        targetType: 'project',
        name: 'Private',
        payload: { targetType: 'project', description: 'Secret' },
        ownerActorId: own.humanActorId,
      })
      .returning();
    await expect(
      prepareWorkTemplateCreation(own.orgId, 'project', { workTypeId: draft?.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('enforces offering teams and matching publication identity before copying the body', async () => {
    const own = await published('project');
    const other = await published('project');
    await db
      .insert(schema.workTypeTeam)
      .values({ organizationId: own.orgId, workTypeId: own.templateId, teamId: own.teamId });
    await expect(
      prepareWorkTemplateCreation(own.orgId, 'project', { workTypeId: own.templateId }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      prepareWorkTemplateCreation(own.orgId, 'project', {
        workTypeId: own.templateId,
        teamId: own.teamId,
        workTypeVersionId: other.versionId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      prepareWorkTemplateCreation(own.orgId, 'project', {
        workTypeId: own.templateId,
        teamId: own.teamId,
      }),
    ).resolves.toMatchObject({ workTypeVersionId: own.versionId });
  });
});
