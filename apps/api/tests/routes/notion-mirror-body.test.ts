/**
 * `@docket/api` — behavioral coverage for page bodies in Docket-built Notion databases.
 *
 * @remarks
 * A record's description is its Notion page body. These cases pin which field that is, that a
 * Notion-side body edit comes back without being pushed over, and that a body Docket did not read
 * in full, or never wrote, is not replaced.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { MirrorChange } from '@docket/connections/notion/mirror-port';
import { orderedColumns } from '@docket/connections/notion/mirror-schema';
import { projectRow, resolveMirrorValues } from '@docket/connections/notion/mirror-values';
import { assertDefined } from '@docket/test-utils';

import type { MirrorDatabaseRow } from '../../src/routes/notion-mirror-design';
import { loadEntityRows } from '../../src/routes/notion-mirror-entities';
import { projectEntity } from '../../src/routes/notion-mirror-reconcile';
import { pullBackEntity } from '../support/entry-point-writers';
import { NO_PAGES, designWithDataSource, seedMirror } from '../support/notion-recording-mirror';
import { getDb, one } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** The Notion page a record is mirrored to. */
async function pageOf(entityId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.notionMirrorRow)
    .where(eq(schema.notionMirrorRow.entityId, entityId));
  return assertDefined(assertDefined(row).externalPageId);
}

/** The task design with Notion property ids and a legacy Description column, as a pull reads it. */
async function taskDesignWithPropertyIds(
  designs: readonly MirrorDatabaseRow[],
): Promise<MirrorDatabaseRow> {
  const seeded = await designWithDataSource(designs, 'task');
  const propertyMap: MirrorDatabaseRow['propertyMap'] = Object.fromEntries(
    Object.entries({
      ...seeded.propertyMap,
      description: { field: 'description', title: 'Description', kind: 'rich_text', order: 99 },
    } satisfies MirrorDatabaseRow['propertyMap']).map(([field, binding]) => [
      field,
      { ...binding, propertyId: `property-${field}` },
    ]),
  );
  await db
    .update(schema.notionMirrorDatabase)
    .set({ propertyMap })
    .where(eq(schema.notionMirrorDatabase.id, seeded.id));
  return { ...seeded, propertyMap };
}

/** A Notion edit that renames a task and carries a clipped legacy Description column. */
function renamedInNotion(pageId: string): MirrorChange {
  return {
    externalPageId: pageId,
    externalUpdatedAt: '2026-09-01T12:00:00.000Z',
    archived: false,
    properties: {
      Title: { id: 'property-title', title: [{ plain_text: 'Renamed in Notion' }] },
      Description: { id: 'property-description', rich_text: [{ plain_text: 'clipped' }] },
    },
    lastEditedBy: 'person-1',
  };
}

describe('Notion mirror page bodies', () => {
  it('writes each record’s description, not its summary, as the page body', async () => {
    const { orgId, designs, mirror, ctx, statusId } = await seedMirror();
    const projectRecord = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Transit campaign',
          summary: 'One-line subtitle',
          description: '## Project brief\n\nThe full plan.',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning(),
    );
    await db.insert(schema.initiative).values({
      organizationId: orgId,
      createdBy: ctx.actorId,
      name: 'North star',
      summary: 'Initiative subtitle',
      description: '## Initiative brief',
      status: 'active',
      statusId: statusId('initiative', 'active'),
    });
    await db.insert(schema.program).values({
      organizationId: orgId,
      name: 'Growth',
      description: '## Program brief',
      statusId: statusId('program', 'active'),
    });
    await db.insert(schema.milestone).values({
      organizationId: orgId,
      projectId: projectRecord.id,
      name: 'Launch',
      description: '## Milestone brief',
    });

    for (const entity of ['project', 'initiative', 'program', 'milestone'] as const) {
      await projectEntity(ctx, await designWithDataSource(designs, entity), 10, NO_PAGES);
    }

    const bodies = mirror.pageContentWrites.map((write) => write.markdown);
    expect(bodies).toEqual(
      expect.arrayContaining([
        '## Project brief\n\nThe full plan.',
        '## Initiative brief',
        '## Program brief',
        '## Milestone brief',
      ]),
    );
    expect(bodies).not.toContain('One-line subtitle');
    expect(bodies).not.toContain('Initiative subtitle');
  });

  it('pulls a page body edited in Notion onto an unchanged record without pushing it back', async () => {
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const taskDesign = await designWithDataSource(designs, 'task');
    const projectDesign = await designWithDataSource(designs, 'project');
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Draft the brief',
          description: 'Docket body',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    const projectRecord = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Transit campaign',
          description: 'Docket brief',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning(),
    );
    await projectEntity(ctx, taskDesign, 10, NO_PAGES);
    await projectEntity(ctx, projectDesign, 10, NO_PAGES);
    const writesBefore = mirror.writes.length;
    const bodyWritesBefore = mirror.pageContentWrites.length;

    for (const [design, entityId, markdown] of [
      [taskDesign, taskRow.id, '## Rewritten in Notion'],
      [projectDesign, projectRecord.id, '## Brief rewritten in Notion'],
    ] as const) {
      const bindings = orderedColumns(design.propertyMap);
      const [record] = (await loadEntityRows(orgId, ctx.integrationId, design.entityType)).filter(
        (candidate) => candidate.entityId === entityId,
      );
      const pageId = await pageOf(entityId);
      mirror.pageContents.set(pageId, markdown);
      mirror.changes = [
        {
          externalPageId: pageId,
          externalUpdatedAt: '2026-09-01T12:00:00.000Z',
          archived: false,
          properties: projectRow(
            bindings,
            resolveMirrorValues(bindings, assertDefined(record).values, NO_PAGES).values,
          ).properties,
          lastEditedBy: 'person-1',
        },
      ];
      expect(await pullBackEntity(ctx, design, 10, NO_PAGES)).toMatchObject({
        written: 1,
        conflicts: 0,
      });
    }

    const [pulledTask] = await db.select().from(schema.task).where(eq(schema.task.id, taskRow.id));
    const [pulledProject] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, projectRecord.id));
    expect(pulledTask?.description).toBe('## Rewritten in Notion');
    expect(pulledProject?.description).toBe('## Brief rewritten in Notion');

    // Neither the pull nor the next projection writes anything back.
    await projectEntity(ctx, taskDesign, 10, NO_PAGES);
    await projectEntity(ctx, projectDesign, 10, NO_PAGES);
    expect(mirror.writes).toHaveLength(writesBefore);
    expect(mirror.pageContentWrites).toHaveLength(bodyWritesBefore);
  });

  it('retries a page body Notion refused and leaves a truncated page alone', async () => {
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await taskDesignWithPropertyIds(designs);
    const rows = await db
      .insert(schema.task)
      .values(
        ['Refused', 'Truncated'].map((title) => ({
          organizationId: orgId,
          teamId,
          title,
          description: `${title} body`,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })),
      )
      .returning();
    await projectEntity(ctx, design, 10, NO_PAGES);
    const [refused, truncated] = rows;
    for (const [row, bodyState] of [
      [assertDefined(refused), 'inaccessible'],
      [assertDefined(truncated), 'truncated'],
    ] as const) {
      await db
        .update(schema.notionMirrorRow)
        .set({ bodyState })
        .where(eq(schema.notionMirrorRow.entityId, row.id));
    }
    // A property edit on the truncated page must not replace the blocks Docket never read.
    await db
      .update(schema.task)
      .set({ title: 'Truncated, renamed' })
      .where(eq(schema.task.id, assertDefined(truncated).id));
    mirror.pageContentWrites.length = 0;

    await projectEntity(ctx, design, 10, NO_PAGES);

    expect(mirror.writes.filter((write) => write.kind === 'update')).toHaveLength(1);
    expect(mirror.pageContentWrites.map((write) => write.markdown)).toEqual(['Refused body']);
  });

  it('does not queue a body it could not read on a pull for the access retry', async () => {
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await taskDesignWithPropertyIds(designs);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Draft the brief',
          description: 'Docket body',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    await projectEntity(ctx, design, 10, NO_PAGES);
    const pageId = await pageOf(taskRow.id);
    mirror.unreadablePages.add(pageId);
    mirror.changes = [renamedInNotion(pageId)];

    await pullBackEntity(ctx, design, 10, NO_PAGES);
    // Access is granted after someone rewrote the page body in Notion.
    mirror.unreadablePages.delete(pageId);
    mirror.pageContents.set(pageId, '## Rewritten in Notion');
    await projectEntity(ctx, design, 10, NO_PAGES);

    const [row] = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.entityId, taskRow.id));
    expect(row?.bodyState).toBe('complete');
    expect(mirror.pageContents.get(pageId)).toBe('## Rewritten in Notion');
  });

  it('keeps a page Notion will not replace and keeps syncing its properties', async () => {
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await designWithDataSource(designs, 'task');
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Draft the brief',
          description: 'Docket body',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    await projectEntity(ctx, design, 10, NO_PAGES);
    mirror.refusedPages.add(await pageOf(taskRow.id));
    await db
      .update(schema.task)
      .set({ title: 'Renamed', description: 'Edited body' })
      .where(eq(schema.task.id, taskRow.id));

    await expect(projectEntity(ctx, design, 10, NO_PAGES)).resolves.toMatchObject({ written: 1 });
    await projectEntity(ctx, design, 10, NO_PAGES);

    const [row] = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.entityId, taskRow.id));
    expect(row?.bodyState).toBe('truncated');
    expect(mirror.writes.filter((write) => write.kind === 'update')).toHaveLength(1);
    expect(mirror.pageContentWrites.map((write) => write.markdown)).toEqual(['Docket body']);
  });

  it('never replaces a page body Docket did not write with an empty description', async () => {
    const { orgId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await designWithDataSource(designs, 'initiative');
    const initiative = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          createdBy: ctx.actorId,
          name: 'North star',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning(),
    );
    await projectEntity(ctx, design, 10, NO_PAGES);
    // A row mirrored before page bodies synced: no body hash, and a hash that no longer matches.
    await db
      .update(schema.notionMirrorRow)
      .set({ bodyHash: null, contentHash: 'before-page-body-sync' })
      .where(eq(schema.notionMirrorRow.entityId, initiative.id));

    await projectEntity(ctx, design, 10, NO_PAGES);

    expect(mirror.writes.filter((write) => write.kind === 'update')).toHaveLength(1);
    expect(mirror.pageContentWrites).toEqual([]);
  });

  it('clears a page body Docket wrote when the description is cleared', async () => {
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await designWithDataSource(designs, 'task');
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Draft the brief',
          description: 'Docket body',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    await projectEntity(ctx, design, 10, NO_PAGES);
    await db.update(schema.task).set({ description: null }).where(eq(schema.task.id, taskRow.id));

    await projectEntity(ctx, design, 10, NO_PAGES);

    expect(mirror.pageContentWrites.map((write) => write.markdown)).toEqual(['Docket body', '']);
  });

  it('reverts drift on a projection-only record without reading its page body', async () => {
    const { orgId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await designWithDataSource(designs, 'initiative');
    const initiative = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          createdBy: ctx.actorId,
          name: 'North star',
          description: 'Docket brief',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning(),
    );
    await projectEntity(ctx, design, 10, NO_PAGES);
    mirror.changes = [
      {
        externalPageId: await pageOf(initiative.id),
        externalUpdatedAt: '2026-09-01T12:00:00.000Z',
        archived: false,
        properties: {},
        lastEditedBy: 'person-1',
      },
    ];

    await pullBackEntity(ctx, design, 10, NO_PAGES);

    expect(mirror.pageContentReads).toEqual([]);
  });

  it('adopts a row created in Notion with its page body as the description', async () => {
    const { designs, mirror, ctx } = await seedMirror();
    const design = await designWithDataSource(designs, 'project');
    mirror.pageContents.set('page-new-project', '## Written in Notion');
    mirror.changes = [
      {
        externalPageId: 'page-new-project',
        externalUpdatedAt: '2026-09-01T12:00:00.000Z',
        archived: false,
        properties: {},
        lastEditedBy: 'person-1',
      },
    ];

    await pullBackEntity(ctx, design, 10, NO_PAGES);
    await projectEntity(ctx, design, 10, NO_PAGES);

    const [mapping] = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.externalPageId, 'page-new-project'));
    const [adopted] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, assertDefined(mapping).entityId));
    expect(adopted?.description).toBe('## Written in Notion');
    expect(mirror.pageContents.get('page-new-project')).toBe('## Written in Notion');

    // A later Notion edit to the adopted row is a plain pull, never a contested push.
    mirror.changes = [
      { ...assertDefined(mirror.changes[0]), externalUpdatedAt: '2026-09-02T12:00:00.000Z' },
    ];
    await expect(pullBackEntity(ctx, design, 10, NO_PAGES)).resolves.toMatchObject({
      conflicts: 0,
    });
    expect(mirror.writes).toEqual([]);
  });

  it('keeps the full description when Notion truncates the page body on a pull', async () => {
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const design = await taskDesignWithPropertyIds(designs);
    const fullBody = `## Long brief\n\n${'x'.repeat(2500)}`;
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Draft the brief',
          description: fullBody,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    await projectEntity(ctx, design, 10, NO_PAGES);
    const pageId = await pageOf(taskRow.id);
    mirror.truncatedPages.add(pageId);
    mirror.changes = [renamedInNotion(pageId)];

    await pullBackEntity(ctx, design, 10, NO_PAGES);

    const [after] = await db.select().from(schema.task).where(eq(schema.task.id, taskRow.id));
    expect(after?.title).toBe('Renamed in Notion');
    expect(after?.description).toBe(fullBody);
  });
});
