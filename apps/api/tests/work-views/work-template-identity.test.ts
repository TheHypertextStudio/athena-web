import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { ViewTarget } from '@docket/work/view-contract';
import {
  WorkViewFacetRequest,
  WorkViewOrderRequest,
  WorkViewQueryRequest,
} from '@docket/work/work-view-contract';
import { queryWorkView } from '../../src/lib/work-views/query';
import { queryWorkViewFacets } from '../../src/lib/work-views/facets';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

function request(target: ViewTarget) {
  return WorkViewQueryRequest.parse({
    target,
    context: { kind: 'organization' },
    limit: 1,
    definition: {
      version: 2,
      target,
      filter: null,
      arrangement: { groupBy: 'workTypeId', subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['workTypeId'],
        density: 'compact',
        showEmptyGroups: false,
      },
    },
  });
}

async function publishedTemplate(organizationId: string, target: ViewTarget, name: string) {
  const definition = WorkTemplateDefinition.parse({
    name,
    description: null,
    icon: { kind: 'symbol' as const, name: 'event' },
    payload: { targetType: target },
  });
  const [row] = await schema.db
    .insert(schema.template)
    .values({
      organizationId,
      targetType: target,
      name,
      scope: 'organization',
      payload: definition.payload,
      draftDefinition: definition,
      icon: definition.icon,
      publicationState: 'draft',
    })
    .returning();
  if (!row) throw new Error('Template fixture missing');
  const [version] = await schema.db
    .insert(schema.workTypeVersion)
    .values({ organizationId, workTypeId: row.id, number: 1, definition })
    .returning();
  if (!version) throw new Error('Version fixture missing');
  await schema.db
    .update(schema.template)
    .set({ latestPublishedVersionId: version.id, publicationState: 'published' })
    .where(eq(schema.template.id, row.id));
  return { row, version, definition };
}

async function seedWork(
  target: ViewTarget,
  fixture: Awaited<ReturnType<typeof seedBaseOrg>>,
  template: Awaited<ReturnType<typeof publishedTemplate>>,
) {
  const common = {
    organizationId: fixture.orgId,
    visibility: 'public' as const,
    workTypeId: template.row.id,
    workTypeVersionId: template.version.id,
  };
  for (const name of ['First', 'Second']) {
    switch (target) {
      case 'task':
        await schema.db.insert(schema.task).values({
          ...common,
          teamId: fixture.teamId,
          title: name,
          state: 'todo',
          statusId: fixture.statusId('task', 'todo'),
        });
        break;
      case 'project':
        await schema.db.insert(schema.project).values({
          ...common,
          teamId: fixture.teamId,
          name,
          status: 'planned',
          statusId: fixture.statusId('project', 'planned'),
        });
        break;
      case 'program':
        await schema.db.insert(schema.program).values({
          ...common,
          name,
          status: 'active',
          statusId: fixture.statusId('program', 'active'),
        });
        break;
      case 'initiative':
        await schema.db.insert(schema.initiative).values({
          ...common,
          name,
          status: 'active',
          statusId: fixture.statusId('initiative', 'active'),
        });
        break;
    }
  }
}

describe('published template work views', () => {
  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'filters, groups, and paginates %s by immutable published identity',
    async (target) => {
      const fixture = await seedBaseOrg(schema.db, schema);
      const template = await publishedTemplate(fixture.orgId, target, 'Event');
      await seedWork(target, fixture, template);
      if (target !== 'initiative') {
        const hidden = await publishedTemplate(fixture.orgId, target, 'Hidden work template');
        await seedWork(target, fixture, hidden);
        await schema.db.execute(sql`update ${sql.raw(target)} set visibility='private'
        where organization_id=${fixture.orgId} and work_type_id=${hidden.row.id}`);
        await schema.db
          .update(schema.template)
          .set({ publicationState: 'archived', archivedAt: new Date() })
          .where(eq(schema.template.id, hidden.row.id));
      }
      const foreignWorkspace = await seedBaseOrg(schema.db, schema);
      const foreign = await publishedTemplate(foreignWorkspace.orgId, target, 'Foreign template');
      const later = await schema.db
        .insert(schema.workTypeVersion)
        .values({
          organizationId: fixture.orgId,
          workTypeId: template.row.id,
          number: 2,
          definition: { ...template.definition, name: 'Event v2' },
        })
        .returning();
      await schema.db
        .update(schema.template)
        .set({
          latestPublishedVersionId: later[0]?.id,
          name: 'Event v2',
          draftDefinition: { ...template.definition, name: 'PRIVATE DRAFT NAME' },
        })
        .where(eq(schema.template.id, template.row.id));
      const query = request(target);
      const input = {
        database: schema.db,
        organizationId: fixture.orgId,
        actorId: fixture.humanActorId,
      };
      const first = await queryWorkView({ ...input, request: query });
      expect(first.totalCount).toBe(2);
      expect(first.groups).toEqual([
        expect.objectContaining({
          key: template.row.id,
          label: 'Event v2',
          count: 2,
          mutable: false,
        }),
      ]);
      expect(first.rows[0]).toMatchObject({
        workTypeId: template.row.id,
        workTypeVersionId: template.version.id,
        workTemplate: { name: 'Event', versionNumber: 1, latestVersionNumber: 2 },
      });
      expect(Object.keys(first.rows[0]?.workTemplate ?? {}).sort()).toEqual([
        'archived',
        'icon',
        'id',
        'isBase',
        'latestVersionNumber',
        'name',
        'versionNumber',
      ]);
      expect(first.nextCursor).not.toBeNull();
      const second = await queryWorkView({
        ...input,
        request: { ...query, cursor: first.nextCursor },
      });
      expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(2);
      expect(second.nextCursor).toBeNull();
      const filtered = WorkViewQueryRequest.parse({
        ...query,
        definition: {
          ...query.definition,
          filter: {
            kind: 'predicate',
            field: 'workTypeId',
            operator: 'is',
            operand: template.row.id,
          },
        },
      });
      expect((await queryWorkView({ ...input, request: filtered })).totalCount).toBe(2);
      const foreignFilter = WorkViewQueryRequest.parse({
        ...filtered,
        definition: {
          ...filtered.definition,
          filter: {
            kind: 'predicate',
            field: 'workTypeId',
            operator: 'is',
            operand: foreign.row.id,
          },
        },
      });
      expect((await queryWorkView({ ...input, request: foreignFilter })).totalCount).toBe(0);
      expect(
        WorkViewOrderRequest.safeParse({
          target,
          itemId: first.rows[0]?.id,
          groupField: 'workTypeId',
          groupValue: template.row.id,
          beforeId: null,
          afterId: null,
        }).success,
      ).toBe(false);
      const noMatches = WorkViewFacetRequest.parse({
        ...query,
        fields: ['workTypeId'],
        limit: 100,
        definition: {
          ...query.definition,
          filter: { kind: 'predicate', field: 'status', operator: 'is', operand: '__unused__' },
        },
      });
      await schema.db
        .update(schema.template)
        .set({ publicationState: 'archived', archivedAt: new Date() })
        .where(eq(schema.template.id, template.row.id));
      const choices = await queryWorkViewFacets({ ...input, request: noMatches });
      expect(choices.buckets[0]?.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: template.row.id, label: 'Event v2', count: 0 }),
        ]),
      );
      expect(choices.buckets[0]?.options.map((option) => option.label)).not.toContain(
        'Hidden work template',
      );
      expect(JSON.stringify(first)).not.toContain('PRIVATE DRAFT NAME');
    },
  );

  it('keeps hidden drafts and other workspaces out of facets, retains used archives, and derives base vocabulary', async () => {
    const fixture = await seedBaseOrg(schema.db, schema);
    const other = await seedBaseOrg(schema.db, schema);
    const used = await publishedTemplate(fixture.orgId, 'initiative', 'Retained event');
    const unused = await publishedTemplate(fixture.orgId, 'initiative', 'Unused archive');
    await seedWork('initiative', fixture, used);
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, used.row.id));
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, unused.row.id));
    const foreign = await publishedTemplate(other.orgId, 'initiative', 'OTHER WORKSPACE');
    await seedWork('initiative', other, foreign);
    await schema.db.insert(schema.template).values({
      organizationId: fixture.orgId,
      targetType: 'initiative',
      name: 'PRIVATE DRAFT',
      scope: 'personal',
      ownerActorId: fixture.humanActorId,
      payload: { targetType: 'initiative' },
      draftDefinition: {
        name: 'PRIVATE DRAFT',
        defaultStatusKey: null,
        description: null,
        icon: null,
        payload: { targetType: 'initiative', description: 'PRIVATE DRAFT BODY' },
      },
    });
    await schema.db
      .update(schema.organization)
      .set({ vocabulary: { preset: 'nonprofit' } })
      .where(eq(schema.organization.id, fixture.orgId));
    const query = request('initiative');
    const facets = await queryWorkViewFacets({
      database: schema.db,
      organizationId: fixture.orgId,
      actorId: fixture.humanActorId,
      request: WorkViewFacetRequest.parse({ ...query, fields: ['workTypeId'], limit: 100 }),
    });
    expect(facets.buckets[0]?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(['Blank campaign', 'Retained event']),
    );
    const firstFacetRequest = WorkViewFacetRequest.parse({
      ...query,
      fields: ['workTypeId'],
      limit: 1,
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await queryWorkViewFacets({
        database: schema.db,
        organizationId: fixture.orgId,
        actorId: fixture.humanActorId,
        request: WorkViewFacetRequest.parse({
          ...firstFacetRequest,
          ...(cursor ? { cursor } : {}),
        }),
      });
      seen.push(...(page.buckets[0]?.options.map((option) => option.label) ?? []));
      cursor = page.buckets[0]?.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.sort()).toEqual(['Blank campaign', 'Retained event']);
    const text = JSON.stringify(facets);
    expect(text).not.toMatch(/PRIVATE DRAFT|OTHER WORKSPACE|Unused archive/);
  });
});
