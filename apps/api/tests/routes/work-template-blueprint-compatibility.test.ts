import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type templatesRouter from '../../src/routes/templates';

let schema: typeof DbModule;
let router: typeof templatesRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/templates')).default;
});

const legacyDefinition = {
  name: 'Historical event',
  description: null,
  icon: null,
  defaultStatusKey: null,
  payload: { targetType: 'project' as const, description: 'Keep the venue outline.' },
};

/** Seed an immutable historical publication without rewriting its pre-blueprint JSON. */
async function historicalPublication() {
  const seeded = await seedBaseOrg(schema.db, schema);
  const current = WorkTemplateDefinition.parse(legacyDefinition);
  const [definition] = await schema.db
    .insert(schema.template)
    .values({
      organizationId: seeded.orgId,
      targetType: 'project',
      name: legacyDefinition.name,
      payload: legacyDefinition.payload,
      scope: 'organization',
      ownerActorId: seeded.humanActorId,
      createdBy: seeded.humanActorId,
      draftDefinition: current,
    })
    .returning();
  if (!definition) throw new Error('Missing historical definition');
  const [version] = await schema.db
    .insert(schema.workTypeVersion)
    .values({
      organizationId: seeded.orgId,
      workTypeId: definition.id,
      number: 1,
      definition: sql<WorkTemplateDefinition>`${JSON.stringify(legacyDefinition)}::jsonb`,
      publishedByActorId: seeded.humanActorId,
    })
    .returning();
  if (!version) throw new Error('Missing historical version');
  await schema.db
    .update(schema.template)
    .set({ latestPublishedVersionId: version.id, publicationState: 'published' })
    .where(eq(schema.template.id, definition.id));
  return {
    ...seeded,
    definitionId: definition.id,
    versionId: version.id,
    current,
    app: appWithActor(router, seeded.orgId, ['manage'], seeded.humanActorId),
  };
}

describe('historical work-template blueprint compatibility', () => {
  it('permits a legacy rename after a normalized empty draft without rewriting the old version', async () => {
    const fixture = await historicalPublication();
    const response = await fixture.app.request(`/${fixture.definitionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed event' }),
    });
    expect(response.status).toBe(200);
    const [retained] = await schema.db
      .select()
      .from(schema.workTypeVersion)
      .where(eq(schema.workTypeVersion.id, fixture.versionId));
    expect(retained?.definition).toEqual(legacyDefinition);
    const [current] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, fixture.definitionId));
    expect(current?.draftDefinition.blueprint).toEqual({ steps: [], dependencies: [] });
    expect(current?.draftDefinition.payload.description).toBe('Keep the venue outline.');
  });

  it('still refuses legacy writes when the normalized draft has meaningful new children', async () => {
    const fixture = await historicalPublication();
    await schema.db
      .update(schema.template)
      .set({
        draftDefinition: WorkTemplateDefinition.parse({
          ...fixture.current,
          blueprint: {
            dependencies: [],
            steps: [
              {
                key: 'preparation',
                kind: 'task',
                parentStepKey: null,
                sort: 0,
                optional: { enabled: false, selectedByDefault: true },
                template: null,
                fields: { title: 'Prepare the venue' },
                teamRule: 'parent_team',
                actorRule: 'unassigned',
                cycleRule: 'none',
                dates: {},
              },
            ],
          },
        }),
      })
      .where(eq(schema.template.id, fixture.definitionId));
    const response = await fixture.app.request(`/${fixture.definitionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Must retain unpublished children' }),
    });
    expect(response.status).toBe(409);
    const [current] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, fixture.definitionId));
    expect(current?.draftDefinition.blueprint.steps).toHaveLength(1);
    expect(current?.latestPublishedVersionId).toBe(fixture.versionId);
  });
});
