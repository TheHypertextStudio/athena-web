/**
 * `@docket/api` — the Notion mirror designer's persistence and preview contract.
 *
 * @remarks
 * These tests deliberately use the real migrated database. The designer is a database-only
 * surface, so exercising its tenant-scoped reads and writes is both faster and more faithful than
 * replacing Drizzle with a fluent mock.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { MIRROR_ENTITY_ORDER } from '@docket/integrations';

import { ConflictError, NotFoundError } from '../../src/error';
import {
  applyDesignPatch,
  availableFields,
  buildDesignOut,
  buildPreview,
  cellFor,
  ensureDesigns,
  formatDate,
  loadDesign,
  toMirrorDatabaseOut,
} from '../../src/routes/notion-mirror-design';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedDesigner() {
  const base = await seedBaseOrg(db, schema);
  const integration = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: base.orgId,
        provider: 'notion',
        pattern: 'connector',
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  return { ...base, integration };
}

describe('Notion mirror designs', () => {
  it('seeds every catalog entity once, in designer order, using workspace vocabulary', async () => {
    const { orgId, humanActorId, integration } = await seedDesigner();
    await db
      .update(schema.organization)
      .set({
        vocabulary: {
          preset: 'startup',
          overrides: { task: { singular: 'Assignment', plural: 'Assignments' } },
        },
      })
      .where(eq(schema.organization.id, orgId));

    const first = await ensureDesigns(orgId, integration.id, humanActorId);
    const second = await ensureDesigns(orgId, integration.id, humanActorId);

    expect(first.map((row) => row.entityType)).toEqual(MIRROR_ENTITY_ORDER);
    expect(second).toHaveLength(MIRROR_ENTITY_ORDER.length);
    expect(first.find((row) => row.entityType === 'task')?.title).toBe('Assignments');
  });

  it('loads and serializes a design without inventing provisioning timestamps', async () => {
    const { orgId, humanActorId, integration } = await seedDesigner();
    await ensureDesigns(orgId, integration.id, humanActorId);
    const row = await loadDesign(orgId, integration.id, 'task');

    expect(toMirrorDatabaseOut(row)).toMatchObject({
      id: row.id,
      entityType: 'task',
      direction: 'two_way',
      provisionedAt: null,
      lastPushedAt: null,
      lastPulledAt: null,
    });
    await expect(loadDesign(orgId, integration.id, 'project')).resolves.toBeDefined();
    await expect(loadDesign('another-org', integration.id, 'task')).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const timestamp = new Date('2026-08-10T12:00:00.000Z');
    const stamped = one(
      await db
        .update(schema.notionMirrorDatabase)
        .set({ provisionedAt: timestamp, lastPushedAt: timestamp, lastPulledAt: timestamp })
        .where(eq(schema.notionMirrorDatabase.id, row.id))
        .returning(),
    );
    expect(toMirrorDatabaseOut(stamped)).toMatchObject({
      provisionedAt: timestamp.toISOString(),
      lastPushedAt: timestamp.toISOString(),
      lastPulledAt: timestamp.toISOString(),
    });
  });

  it('rejects destructive or ambiguous column sets before saving', async () => {
    const { orgId, humanActorId, integration } = await seedDesigner();
    const row = (await ensureDesigns(orgId, integration.id, humanActorId)).find(
      (candidate) => candidate.entityType === 'task',
    );
    if (!row) throw new Error('task design was not seeded');

    await expect(
      applyDesignPatch(row, { columns: [{ field: 'state', title: 'Status' }] }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      applyDesignPatch(row, {
        columns: [
          { field: 'title', title: 'Same' },
          { field: 'state', title: ' same ' },
        ],
      }),
    ).rejects.toThrow('each column to have its own name');
    await expect(
      applyDesignPatch(row, {
        columns: [
          { field: 'title', title: 'Name' },
          { field: 'retired_field', title: 'Old client field' },
        ],
      }),
    ).rejects.toThrow('Unknown column');
  });

  it('preserves provider identities and person choices while replacing ordered columns', async () => {
    const { orgId, humanActorId, integration } = await seedDesigner();
    const seeded = (await ensureDesigns(orgId, integration.id, humanActorId)).find(
      (candidate) => candidate.entityType === 'task',
    );
    if (!seeded) throw new Error('task design was not seeded');
    const row = one(
      await db
        .update(schema.notionMirrorDatabase)
        .set({
          propertyMap: {
            ...seeded.propertyMap,
            title: { ...seeded.propertyMap['title']!, propertyId: 'prop_title' },
            assignee: {
              ...seeded.propertyMap['assignee']!,
              representation: 'notion_person',
              propertyId: 'prop_assignee',
            },
          },
        })
        .where(eq(schema.notionMirrorDatabase.id, seeded.id))
        .returning(),
    );

    expect(await applyDesignPatch(row, {})).toEqual(row);
    const updated = await applyDesignPatch(row, {
      title: 'Delivery work',
      enabled: false,
      columns: [
        { field: 'title', title: '  Work  ' },
        { field: 'assignee', title: 'Owner' },
        { field: 'project', title: '   ', relationDataSourceId: 'ds_projects' },
      ],
    });

    expect(updated).toMatchObject({ title: 'Delivery work', enabled: false, schemaVersion: 2 });
    expect(updated.propertyMap).toEqual({
      title: {
        field: 'title',
        title: 'Work',
        kind: 'title',
        order: 0,
        propertyId: 'prop_title',
      },
      assignee: {
        field: 'assignee',
        title: 'Owner',
        // `rich_text`, NOT `people`: the native Notion property is ADDED beside this column, never
        // substituted for it. Substituting would delete the only column able to hold a person with
        // no Notion account — the population the representation exists to protect.
        kind: 'rich_text',
        order: 1,
        propertyId: 'prop_assignee',
        representation: 'notion_person',
      },
      // Derived from the parent's representation, never sent by the client, and named after the
      // parent's own title so a rename carries.
      assigneeNotionPerson: {
        field: 'assigneeNotionPerson',
        title: 'Owner (Notion)',
        kind: 'people',
        order: 2,
      },
      project: {
        field: 'project',
        title: 'Project',
        kind: 'relation',
        order: 3,
        relationDataSourceId: 'ds_projects',
      },
    });

    // Docket owns no page ids in a database it did not create, so it could never fill this in.
    // Refused rather than accepted and silently left blank, which is what used to happen.
    await expect(
      applyDesignPatch(updated, {
        columns: [
          { field: 'title', title: 'Work' },
          { field: 'assignee', title: 'Owner', representation: 'existing_table' },
          { field: 'project', title: 'Project' },
        ],
      }),
    ).rejects.toThrow();

    const explicitlyChanged = await applyDesignPatch(updated, {
      columns: [
        { field: 'title', title: 'Work' },
        { field: 'assignee', title: 'Owner', representation: 'docket_people_table' },
        { field: 'project', title: 'Project' },
      ],
    });
    expect(explicitlyChanged.propertyMap['assignee']?.representation).toBe('docket_people_table');
    // Switching away from `notion_person` takes its companion with it: the column exists only
    // because that representation was chosen.
    expect(explicitlyChanged.propertyMap['assigneeNotionPerson']).toBeUndefined();
    expect(explicitlyChanged.propertyMap['project']?.relationDataSourceId).toBe('ds_projects');

    const withoutPreviousChoices = await applyDesignPatch(
      { ...explicitlyChanged, propertyMap: { title: explicitlyChanged.propertyMap['title']! } },
      {
        columns: [
          { field: 'title', title: 'Work' },
          { field: 'assignee', title: 'Owner' },
          { field: 'project', title: 'Project' },
        ],
      },
    );
    expect(withoutPreviousChoices.propertyMap['assignee']?.representation).toBe('text');
    expect(withoutPreviousChoices.propertyMap['project']?.relationDataSourceId).toBeUndefined();
  });

  it('describes person-valued and required fields explicitly', () => {
    const fields = availableFields('task', null);
    expect(fields.find((field) => field.field === 'title')).toMatchObject({ required: true });
    expect(fields.find((field) => field.field === 'assignee')).toMatchObject({
      personValued: true,
    });
    expect(fields.find((field) => field.field === 'description')).toMatchObject({
      personValued: false,
      required: false,
    });
  });

  it('formats every preview scalar and fallback without inventing invalid values', () => {
    const date = new Date('2026-08-10T12:30:00.000Z');
    expect(formatDate(null)).toBeNull();
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate('not-a-date')).toBeNull();
    expect(formatDate('2026-08-11T00:00:00.000Z')).toBe('2026-08-11');
    expect(formatDate(date)).toBe('2026-08-10');

    expect(cellFor('cycle', 'number', { number: 7 })).toBe('7');
    expect(cellFor('person', 'hasDocketAccount', { hasDocketAccount: true })).toBe('Yes');
    expect(cellFor('person', 'hasDocketAccount', { hasDocketAccount: false })).toBe('No');
    expect(cellFor('task', 'dueDate', { dueDate: date })).toBe('2026-08-10');
    expect(cellFor('task', 'title', { name: 'Fallback name' })).toBe('Fallback name');
    expect(cellFor('task', 'title', { displayName: 'Fallback person' })).toBe('Fallback person');
    expect(cellFor('person', 'jobTitle', { title: null })).toBeNull();
    expect(cellFor('person', 'hasDocketAccount', { userId: 'user-1' })).toBe('Yes');
    expect(cellFor('person', 'hasDocketAccount', { userId: null })).toBe('No');
    expect(cellFor('task', 'dueDate', { dueDate: null })).toBeNull();
    expect(cellFor('task', 'startDate', { startDate: null })).toBeNull();
    expect(cellFor('task', 'docketUrl', { docketUrl: null })).toBeNull();
    expect(cellFor('task', 'project', { projectId: 'project-1' })).toBeNull();
  });

  it('builds honest sample previews for every empty entity kind', async () => {
    const { orgId, humanActorId, integration } = await seedDesigner();
    const rows = await ensureDesigns(orgId, integration.id, humanActorId);

    for (const row of rows) {
      const preview = await buildPreview(orgId, integration.id, row);
      if (row.entityType === 'team' || row.entityType === 'person') {
        expect(preview.sample).toBe(false);
        expect(preview.totalRows).toBe(1);
      } else {
        expect(preview.sample).toBe(true);
        expect(preview.totalRows).toBe(0);
        expect(preview.rows.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses real task values and reports rows excluded by this integration', async () => {
    const { orgId, teamId, humanActorId, integration } = await seedDesigner();
    const taskDesign = (await ensureDesigns(orgId, integration.id, humanActorId)).find(
      (candidate) => candidate.entityType === 'task',
    );
    if (!taskDesign) throw new Error('task design was not seeded');
    await db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        title: 'Visible task',
        state: 'backlog',
        estimateMinutes: 45,
        dueDate: new Date('2026-09-04T00:00:00.000Z'),
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Already linked here',
        state: 'backlog',
        source: 'linked',
        sourceIntegrationId: integration.id,
        externalId: 'notion-linked-1',
      },
    ]);

    const preview = await buildPreview(orgId, integration.id, taskDesign);
    expect(preview).toMatchObject({ sample: false, totalRows: 1, excludedRows: 1 });
    expect(preview.rows[0]?.cells).toMatchObject({ title: 'Visible task', state: 'backlog' });

    const out = await buildDesignOut(orgId, integration.id, 'task');
    expect(out.database.entityType).toBe('task');
    expect(out.totalRows).toBe(1);
    expect(out.excludedRows).toBe(1);
  });

  it('previews a linked Docket account and its job title without flattening either field', async () => {
    const { orgId, humanActorId, integration } = await seedDesigner();
    const personDesign = (await ensureDesigns(orgId, integration.id, humanActorId)).find(
      (candidate) => candidate.entityType === 'person',
    );
    if (!personDesign) throw new Error('person design was not seeded');
    const user = one(
      await db
        .insert(schema.user)
        .values({ name: 'Ada', email: `ada-${humanActorId}@example.com` })
        .returning(),
    );
    await db
      .update(schema.actor)
      .set({ userId: user.id, title: 'Director' })
      .where(eq(schema.actor.id, humanActorId));

    const preview = await buildPreview(orgId, integration.id, personDesign);
    expect(preview.rows[0]?.cells).toMatchObject({
      displayName: 'Ada',
      jobTitle: 'Director',
      hasDocketAccount: 'Yes',
    });
  });
});
