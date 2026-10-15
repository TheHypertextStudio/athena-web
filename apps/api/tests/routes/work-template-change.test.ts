import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { appWithActor, getDb, one, seedTaskAccessOrg } from '../support/routes-harness';
import { workTemplateAssignmentRoutes } from '../../src/routes/work-template-assignment';

type Kind = 'task' | 'project' | 'initiative' | 'program';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };

async function fixture(kind: Kind = 'project', startingTitle?: string) {
  const f = await seedTaskAccessOrg(
    schema.db,
    schema,
    kind === 'program' ? 'manage' : 'contribute',
  );
  const common = { organizationId: f.orgId, description: 'Manual body', createdBy: f.humanActorId };
  const date = new Date('2027-03-04T00:00:00.000Z');
  const row =
    kind === 'task'
      ? one(
          await schema.db
            .insert(schema.task)
            .values({
              ...common,
              title: 'Manual title',
              teamId: f.teamId,
              statusId: f.statusId('task', 'todo'),
              state: 'todo',
              dueDate: date,
            })
            .returning(),
        )
      : kind === 'project'
        ? one(
            await schema.db
              .insert(schema.project)
              .values({
                ...common,
                name: 'Manual title',
                statusId: f.statusId('project', 'planned'),
                targetDate: date,
              })
              .returning(),
          )
        : kind === 'initiative'
          ? one(
              await schema.db
                .insert(schema.initiative)
                .values({
                  ...common,
                  name: 'Manual title',
                  statusId: f.statusId('initiative', 'active'),
                  targetDate: date,
                })
                .returning(),
            )
          : one(
              await schema.db
                .insert(schema.program)
                .values({
                  ...common,
                  name: 'Manual title',
                  statusId: f.statusId('program', 'active'),
                })
                .returning(),
            );
  const definition = WorkTemplateDefinition.parse({
    name: 'Event',
    payload: {
      targetType: kind,
      description: '## Published outline',
      ...(kind === 'task'
        ? { priority: 'high', ...(startingTitle === undefined ? {} : { title: startingTitle }) }
        : { name: startingTitle ?? 'Starting title' }),
    },
  });
  const template = one(
    await schema.db
      .insert(schema.template)
      .values({
        organizationId: f.orgId,
        targetType: kind,
        name: definition.name,
        scope: 'organization',
        draftDefinition: definition,
        payload: definition.payload,
      })
      .returning(),
  );
  const version = one(
    await schema.db
      .insert(schema.workTypeVersion)
      .values({ organizationId: f.orgId, workTypeId: template.id, number: 1, definition })
      .returning(),
  );
  await schema.db
    .update(schema.template)
    .set({ publicationState: 'published', latestPublishedVersionId: version.id })
    .where(eq(schema.template.id, template.id));
  const selection = { workTypeId: template.id, workTypeVersionId: version.id };
  const app = appWithActor(workTemplateAssignmentRoutes(kind), f.orgId, ['manage'], f.humanActorId);
  const request = (suffix: string, body: object) =>
    app.request(`/${row.id}/template${suffix}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  return { ...f, kind, row, date, definition, template, selection, request };
}

interface Preview {
  previewToken: string;
  changes: { field: string; before: unknown; after: unknown }[];
}

async function preview(f: Awaited<ReturnType<typeof fixture>>): Promise<Preview> {
  const response = await f.request('/preview', f.selection);
  expect(response.status).toBe(200);
  return (await response.json()) as Preview;
}

async function stored(f: Awaited<ReturnType<typeof fixture>>) {
  const table = schema[f.kind];
  return one(await schema.db.select().from(table).where(eq(table.id, f.row.id)));
}

describe('explicit starting-field changes', () => {
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'applies only the selected %s document and preserves dates and other fields',
    async (kind) => {
      const f = await fixture(kind);
      const before = await stored(f);
      const reviewed = await preview(f);
      expect(reviewed.changes).toContainEqual({
        field: 'description',
        label: 'Starting document',
        before: 'Manual body',
        after: '## Published outline',
      });
      const response = await f.request('', {
        ...f.selection,
        previewToken: reviewed.previewToken,
        applyFields: ['description'],
      });
      expect(response.status).toBe(200);
      const after = await stored(f);
      expect(after.description).toBe('## Published outline');
      if ('title' in before) expect(after).toHaveProperty('title', before.title);
      if ('name' in before) expect(after).toHaveProperty('name', before.name);
      if ('dueDate' in before) expect(after).toHaveProperty('dueDate', before.dueDate);
      if ('targetDate' in before) expect(after).toHaveProperty('targetDate', before.targetDate);
    },
  );

  it.each(['task', 'project'] as const)(
    'does not offer an empty %s starting title that would erase valid work',
    async (kind) => {
      const f = await fixture(kind, '');
      const reviewed = await preview(f);
      const titleField = kind === 'task' ? 'title' : 'name';
      expect(reviewed.changes.map((change) => change.field)).not.toContain(titleField);
      expect(
        (
          await f.request('', {
            ...f.selection,
            previewToken: reviewed.previewToken,
            applyFields: [titleField],
          })
        ).status,
      ).toBe(422);
    },
  );

  it('defaults all changes off and rejects choices absent from the preview', async () => {
    const f = await fixture();
    const reviewed = await preview(f);
    expect(
      (
        await f.request('', {
          ...f.selection,
          previewToken: reviewed.previewToken,
          applyFields: ['health'],
        })
      ).status,
    ).toBe(422);
    expect(
      (await f.request('', { ...f.selection, previewToken: reviewed.previewToken })).status,
    ).toBe(200);
    expect((await stored(f)).description).toBe('Manual body');
  });

  it('refuses a stale work snapshot without replacing manual edits', async () => {
    const f = await fixture();
    const reviewed = await preview(f);
    await schema.db
      .update(schema.project)
      .set({ description: 'Edited after preview' })
      .where(eq(schema.project.id, f.row.id));
    expect(
      (
        await f.request('', {
          ...f.selection,
          previewToken: reviewed.previewToken,
          applyFields: ['description'],
        })
      ).status,
    ).toBe(409);
    expect(await stored(f)).toMatchObject({
      description: 'Edited after preview',
      workTypeId: f.row.workTypeId,
    });
    const refreshed = await preview(f);
    expect(refreshed.previewToken).not.toBe(reviewed.previewToken);
    expect(refreshed.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ before: 'Edited after preview' })]),
    );
  });

  it('previews the pinned publication and never an unpublished newer draft', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.template)
      .set({
        draftDefinition: {
          ...f.definition,
          payload: { targetType: 'project', description: 'Confidential next draft' },
        },
      })
      .where(eq(schema.template.id, f.template.id));
    const reviewed = await preview(f);
    expect(JSON.stringify(reviewed)).not.toContain('Confidential');
    expect(
      (
        await f.request('', {
          ...f.selection,
          previewToken: reviewed.previewToken,
          applyFields: ['description'],
        })
      ).status,
    ).toBe(200);
    expect((await stored(f)).description).toBe('## Published outline');
  });

  it('checks current contribution rights before returning any work-body differences', async () => {
    const f = await fixture();
    await schema.db.delete(schema.grant).where(eq(schema.grant.organizationId, f.orgId));
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'project',
      resourceId: f.row.id,
      capabilities: ['view'],
    });
    expect((await f.request('/preview', f.selection)).status).toBe(403);
    const foreign = await fixture();
    expect((await f.request('/preview', foreign.selection)).status).toBe(403);
  });

  it('applies reviewed task labels and status through normal status resolution', async () => {
    const f = await fixture('task');
    const label = one(
      await schema.db
        .insert(schema.label)
        .values({ organizationId: f.orgId, name: 'Starting label', color: 'blue' })
        .returning(),
    );
    const previousLabel = one(
      await schema.db
        .insert(schema.label)
        .values({
          organizationId: f.orgId,
          name: 'Starting label',
          teamId: f.teamId,
          color: 'red',
        })
        .returning(),
    );
    await schema.db
      .insert(schema.taskLabel)
      .values({ organizationId: f.orgId, taskId: f.row.id, labelId: previousLabel.id });
    const definition = WorkTemplateDefinition.parse({
      ...f.definition,
      defaultStatusKey: 'done',
      payload: { targetType: 'task', description: '## Published outline', labelIds: [label.id] },
    });
    const version = one(
      await schema.db
        .insert(schema.workTypeVersion)
        .values({ organizationId: f.orgId, workTypeId: f.template.id, number: 2, definition })
        .returning(),
    );
    await schema.db
      .update(schema.template)
      .set({
        latestPublishedVersionId: version.id,
        draftDefinition: definition,
        payload: definition.payload,
      })
      .where(eq(schema.template.id, f.template.id));
    f.selection.workTypeVersionId = version.id;
    const reviewed = await preview(f);
    expect(
      (
        await f.request('', {
          ...f.selection,
          previewToken: reviewed.previewToken,
          applyFields: ['labels', 'status'],
        })
      ).status,
    ).toBe(200);
    expect(await stored(f)).toMatchObject({
      state: 'done',
      statusId: f.statusId('task', 'done'),
      description: 'Manual body',
      dueDate: f.date,
    });
    expect(await stored(f)).toHaveProperty('completedAt', expect.any(Date));
    expect(
      await schema.db
        .select()
        .from(schema.taskLabel)
        .where(and(eq(schema.taskLabel.taskId, f.row.id), eq(schema.taskLabel.labelId, label.id))),
    ).toHaveLength(1);
  });
});
