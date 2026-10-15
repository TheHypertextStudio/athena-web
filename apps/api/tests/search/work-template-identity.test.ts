import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SearchQuery } from '../../src/contracts/search';
import { SearchHttpQuery } from '../../src/search/http';
import { projectPreloadedSearchDocument } from '../../src/search/registry';
import { backfillSearchIndex, repairSearchIndex } from '../../src/search/backfill';
import { processSearchIndexJobs } from '../../src/search/process-jobs';
import { searchWorkspace } from '../../src/search/query';
import { getDb, one, seedTaskAccessOrg } from '../support/routes-harness';

const templateId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const otherTemplateId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

describe('work-template search identity', () => {
  it('retains template filters in typed and HTTP search inputs', () => {
    expect(SearchQuery.parse({ workTypeIds: [templateId] })).toHaveProperty('workTypeIds', [
      templateId,
    ]);
    expect(
      SearchHttpQuery.parse({ workTypeIds: `${templateId},${otherTemplateId}` }),
    ).toHaveProperty('workTypeIds', [templateId, otherTemplateId]);
    expect(SearchHttpQuery.safeParse({ workTypeIds: 'Event' }).success).toBe(false);
  });

  it.each(['task', 'project', 'program', 'initiative'])(
    'projects the %s identity without indexing template drafts',
    async (kind) => {
      const projected = await projectPreloadedSearchDocument(kind, {
        id: 'work',
        organizationId: 'workspace',
        workTypeId: templateId,
        title: 'Dinner',
        name: 'Dinner',
        teamId: 'team',
        state: 'todo',
        description: 'Authored work body',
        draftDefinition: { payload: { description: 'Private template draft' } },
      });
      expect(projected?.facet).toHaveProperty('workTypeId', templateId);
      expect(projected?.body).toBe('Authored work body');
      expect(JSON.stringify(projected)).not.toContain('Private template draft');
    },
  );

  it.each(['', 'Dinner'])(
    'filters %s search before pagination while preserving visibility and cursor scope',
    async (q) => {
      const schema = await getDb();
      const f = await seedTaskAccessOrg(schema.db, schema, 'view');
      const selected = await publishProjectTemplate(schema, f.orgId);
      const tasks = await schema.db
        .insert(schema.project)
        .values([
          {
            organizationId: f.orgId,
            name: 'Dinner selected one',
            workTypeId: selected,
            statusId: f.statusId('project', 'planned'),
            visibility: 'public',
          },
          {
            organizationId: f.orgId,
            name: 'Dinner selected two',
            workTypeId: selected,
            statusId: f.statusId('project', 'planned'),
            visibility: 'public',
          },
          {
            organizationId: f.orgId,
            name: 'Dinner private selected',
            workTypeId: selected,
            statusId: f.statusId('project', 'planned'),
            visibility: 'private',
          },
          {
            organizationId: f.orgId,
            name: 'Dinner ordinary',
            statusId: f.statusId('project', 'planned'),
            visibility: 'public',
          },
        ])
        .returning();
      const ids = tasks.map((row) => row.id);
      await schema.db.delete(schema.grant).where(eq(schema.grant.organizationId, f.orgId));
      await schema.db.insert(schema.grant).values(
        tasks
          .filter((row) => row.visibility === 'public')
          .map((row) => ({
            organizationId: f.orgId,
            subjectKind: 'actor' as const,
            subjectId: f.humanActorId,
            resourceKind: 'project' as const,
            resourceId: row.id,
            capabilities: ['view' as const],
          })),
      );
      await backfillSearchIndex({ sourceTables: ['project'] });
      await processSearchIndexJobs({ limit: 100 });
      const input = {
        scope: 'org' as const,
        orgId: f.orgId,
        caller: { kind: 'agent' as const, actorId: f.humanActorId, organizationId: f.orgId },
      };
      const params = SearchQuery.parse({
        q,
        kinds: ['project'],
        workTypeIds: [selected],
        limit: 1,
      });
      const first = await searchWorkspace({ ...input, params });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeTruthy();
      expect(first.items[0]?.facets).toHaveProperty('workTypeId', selected);
      expect(first.facets.find((facet) => facet.field === 'workTypeId')?.values).toEqual([
        { value: selected, label: selected, count: q ? 2 : 1 },
      ]);
      const cursor = first.nextCursor;
      if (!cursor) throw new Error('Missing search cursor');
      const second = await searchWorkspace({ ...input, params: { ...params, cursor } });
      expect(second.items).toHaveLength(1);
      expect(new Set([...first.items, ...second.items].map((item) => item.entityId))).toEqual(
        new Set(ids.slice(0, 2)),
      );
      await expect(
        searchWorkspace({
          ...input,
          params: { ...params, cursor, workTypeIds: [otherTemplateId] },
        }),
      ).rejects.toMatchObject({ status: 422 });
    },
  );

  it('repairs retained documents missing identity even when source freshness is unchanged', async () => {
    const schema = await getDb();
    const f = await seedTaskAccessOrg(schema.db, schema);
    const row = one(
      await schema.db
        .insert(schema.project)
        .values({
          organizationId: f.orgId,
          name: 'Retained dinner',
          statusId: f.statusId('project', 'planned'),
          visibility: 'public',
        })
        .returning(),
    );
    await backfillSearchIndex({ sourceTables: ['project'] });
    await processSearchIndexJobs({ limit: 100 });
    await schema.db
      .update(schema.searchDocument)
      .set({ facet: { status: 'planned' } })
      .where(eq(schema.searchDocument.entityId, row.id));
    await repairSearchIndex({ sourceTables: ['project'] });
    expect(
      await schema.db
        .select()
        .from(schema.searchIndexJob)
        .where(
          and(
            eq(schema.searchIndexJob.entityId, row.id),
            eq(schema.searchIndexJob.status, 'pending'),
          ),
        ),
    ).toHaveLength(1);
    await processSearchIndexJobs({ limit: 100 });
    const [document] = await schema.db
      .select()
      .from(schema.searchDocument)
      .where(eq(schema.searchDocument.entityId, row.id));
    expect(document?.facet).toHaveProperty('workTypeId', row.workTypeId);
    const settled = await repairSearchIndex({ sourceTables: ['project'] });
    expect(settled.enqueued).toBe(0);
  });
});

async function publishProjectTemplate(schema: Awaited<ReturnType<typeof getDb>>, orgId: string) {
  const definition = {
    name: 'Event',
    description: null,
    icon: null,
    defaultStatusKey: null,
    payload: { targetType: 'project' as const, description: 'Template outline' },
  };
  const row = one(
    await schema.db
      .insert(schema.template)
      .values({
        organizationId: orgId,
        name: definition.name,
        scope: 'organization',
        targetType: 'project',
        payload: definition.payload,
        draftDefinition: definition,
      })
      .returning(),
  );
  const version = one(
    await schema.db
      .insert(schema.workTypeVersion)
      .values({
        organizationId: orgId,
        workTypeId: row.id,
        number: 1,
        definition,
      })
      .returning(),
  );
  await schema.db
    .update(schema.template)
    .set({ publicationState: 'published', latestPublishedVersionId: version.id })
    .where(eq(schema.template.id, row.id));
  return row.id;
}
