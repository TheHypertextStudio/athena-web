import type * as DbModule from '@docket/db';
import { WorkTemplateCreate, WorkTemplateOut } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  appWithActor,
  getDb,
  one,
  seedProject,
  seedTask,
  seedProgram,
  seedInitiative,
  seedTaskAccessOrg,
} from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };
async function fixture() {
  const f = await seedTaskAccessOrg(schema.db, schema, 'contribute');
  await schema.db
    .update(schema.grant)
    .set({ cascades: false })
    .where(eq(schema.grant.organizationId, f.orgId));
  const root = await seedProject(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    name: 'Community dinner',
    teamId: f.teamId,
    description: '## Outcome\nGather the neighborhood',
    targetDate: new Date('2026-10-15'),
  });
  const child = await seedTask(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    teamId: f.teamId,
    projectId: root.id,
    title: 'Book venue',
    description: '## Venue\nEdited starting work',
    dueDate: new Date('2026-09-24'),
    assigneeId: f.humanActorId,
    state: 'todo',
  });
  const router = (await import('../../src/routes/projects')).default;
  const app = appWithActor(router, f.orgId, ['contribute'], f.humanActorId);
  return { ...f, root, child, app };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function preview(f: Fixture) {
  const response = await f.app.request(`/${f.root.id}/template/save-as/preview`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    sourceSnapshotToken: string;
    descendantCount: number;
    definition: WorkTemplateOut['definition'];
    warnings: { code: string; count: number }[];
  };
}
async function save(f: Fixture, token: string, name = 'Neighborhood dinner') {
  return f.app.request(`/${f.root.id}/template/save-as`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, sourceSnapshotToken: token }),
  });
}

describe('independent authorized Save as template', () => {
  it.each(['task', 'initiative', 'program'] as const)(
    'supports the %s Save-as route without requiring source edit rights',
    async (kind) => {
      const f = await fixture();
      const values = {
        organizationId: f.orgId,
        name: 'Current outline',
        description: '## Original heading',
      };
      const root =
        kind === 'task'
          ? await seedTask(schema.db, schema, f.statusId, {
              organizationId: f.orgId,
              teamId: f.teamId,
              title: values.name,
              description: values.description,
              state: 'todo',
            })
          : kind === 'program'
            ? await seedProgram(schema.db, schema, f.statusId, values)
            : await seedInitiative(schema.db, schema, f.statusId, values);
      const routers = {
        task: () => import('../../src/routes/tasks'),
        program: () => import('../../src/routes/programs'),
        initiative: () => import('../../src/routes/initiatives'),
      };
      const app = appWithActor(
        (await routers[kind]()).default,
        f.orgId,
        ['contribute'],
        f.humanActorId,
      );
      const review = await app.request(`/${root.id}/template/save-as/preview`, { method: 'POST' });
      expect(review.status).toBe(200);
      const captured = (await review.json()) as { sourceSnapshotToken: string };
      const response = await app.request(`/${root.id}/template/save-as`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Reusable outline',
          sourceSnapshotToken: captured.sourceSnapshotToken,
        }),
      });
      expect(response.status).toBe(201);
      const saved = (await response.json()) as { template: unknown };
      expect(WorkTemplateOut.parse(saved.template)).toMatchObject({
        targetType: kind,
        scope: 'personal',
        status: 'draft',
        definition: { payload: { description: values.description }, blueprint: { steps: [] } },
      });
    },
  );

  it('captures edited work with relative dates and no literal placement, then creates an author-only draft without changing source', async () => {
    const f = await fixture();
    const source = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, f.root.id));
    const captured = await preview(f);
    expect(captured.descendantCount).toBe(1);
    expect(captured.definition.payload.description).toBe('## Outcome\nGather the neighborhood');
    expect(captured.definition.blueprint.steps[0]).toMatchObject({
      kind: 'task',
      template: null,
      actorRule: 'creator',
      teamRule: 'parent_team',
      fields: { description: '## Venue\nEdited starting work' },
      dates: { dueDate: { kind: 'anchor', offset: { days: -21, unit: 'calendar' } } },
    });
    const reusable = JSON.stringify(captured.definition);
    for (const id of [f.humanActorId, f.teamId, f.root.id, f.child.id])
      expect(reusable).not.toContain(id);
    const response = await save(f, captured.sourceSnapshotToken);
    expect(response.status).toBe(201);
    const result = (await response.json()) as { template: unknown };
    const draft = WorkTemplateOut.parse(result.template);
    expect(draft).toMatchObject({
      scope: 'personal',
      status: 'draft',
      ownerActorId: f.humanActorId,
      latestVersion: null,
      definition: { name: 'Neighborhood dinner' },
      origin: {
        workTypeId: f.root.workTypeId,
        workTypeVersionId: f.root.workTypeVersionId,
      },
    });
    expect(
      await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)),
    ).toEqual(source);
    const outsider = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Reader' })
        .returning(),
    );
    const templateApp = appWithActor(
      (await import('../../src/routes/templates')).default,
      f.orgId,
      ['view'],
      outsider.id,
    );
    expect((await templateApp.request(`/definitions/${draft.id}`)).status).toBe(404);
  });

  it('retains review warnings for missing anchors and external dependencies while copying only sibling internal edges', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.project)
      .set({ targetDate: null })
      .where(eq(schema.project.id, f.root.id));
    const sibling = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      projectId: f.root.id,
      title: 'Send invitations',
      state: 'todo',
    });
    const external = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Private outside dependency',
      visibility: 'private',
      state: 'todo',
    });
    await schema.db.insert(schema.taskDependency).values([
      { organizationId: f.orgId, blockingTaskId: f.child.id, blockedTaskId: sibling.id },
      { organizationId: f.orgId, blockingTaskId: external.id, blockedTaskId: f.child.id },
    ]);
    const captured = await preview(f);
    expect(captured.definition.blueprint.dependencies).toHaveLength(1);
    expect(captured.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['missing_anchor', 'capture_dependency']),
    );
    expect(JSON.stringify(captured)).not.toContain('Private outside dependency');
    expect(
      captured.definition.blueprint.steps.find(
        (step) => step.kind === 'task' && step.fields.title === 'Book venue',
      )?.dates,
    ).toEqual({});
  });

  it.each(['body', 'manual-date', 'membership', 'weekdays'] as const)(
    'refuses a stale %s snapshot before creating a draft',
    async (change) => {
      const f = await fixture();
      const captured = await preview(f);
      if (change === 'body')
        await schema.db
          .update(schema.task)
          .set({ description: 'New authored prose' })
          .where(eq(schema.task.id, f.child.id));
      if (change === 'manual-date')
        await schema.db
          .update(schema.task)
          .set({ dueDate: null })
          .where(eq(schema.task.id, f.child.id));
      if (change === 'membership')
        await seedTask(schema.db, schema, f.statusId, {
          organizationId: f.orgId,
          teamId: f.teamId,
          projectId: f.root.id,
          title: 'Added work',
          state: 'todo',
        });
      if (change === 'weekdays')
        await schema.db
          .update(schema.organization)
          .set({ workingWeekdays: [1, 2, 3, 4] })
          .where(eq(schema.organization.id, f.orgId));
      expect((await save(f, captured.sourceSnapshotToken)).status).toBe(409);
      expect(
        await schema.db
          .select()
          .from(schema.template)
          .where(
            and(eq(schema.template.organizationId, f.orgId), eq(schema.template.isBase, false)),
          ),
      ).toEqual([]);
    },
  );

  it('refuses hidden descendants and foreign document-image URLs instead of copying private prose', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, f.child.id));
    const hidden = await f.app.request(`/${f.root.id}/template/save-as/preview`, {
      method: 'POST',
    });
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain('Edited starting work');
    await schema.db
      .update(schema.task)
      .set({
        visibility: 'public',
        description: '![Private figure](/v1/orgs/foreign/images/unowned)',
      })
      .where(eq(schema.task.id, f.child.id));
    const inaccessible = await f.app.request(`/${f.root.id}/template/save-as/preview`, {
      method: 'POST',
    });
    expect(inaccessible.status).toBe(404);
    expect(await inaccessible.text()).not.toContain('/v1/orgs/foreign');
  });

  it('retains an owned inline child image in the saved private draft reference projection', async () => {
    const f = await fixture();
    const imageId = `capture_image_${f.orgId}`;
    await schema.db.insert(schema.documentImage).values({
      id: imageId,
      organizationId: f.orgId,
      blobKey: `document-images/${f.orgId}/${imageId}`,
      mimeType: 'image/png',
      byteSize: 10,
    });
    const markdown = `## Reference\n![Room](/v1/orgs/${f.orgId}/images/${imageId})`;
    await schema.db
      .update(schema.task)
      .set({ description: markdown })
      .where(eq(schema.task.id, f.child.id));
    const captured = await preview(f);
    const response = await save(f, captured.sourceSnapshotToken);
    expect(response.status).toBe(201);
    const saved = (await response.json()) as { template: { id: string } };
    expect(
      await schema.db
        .select()
        .from(schema.documentImageReference)
        .where(
          and(
            eq(schema.documentImageReference.subjectId, saved.template.id),
            eq(schema.documentImageReference.imageId, imageId),
          ),
        ),
    ).toHaveLength(1);
    expect(captured.definition.blueprint.steps[0]?.fields.description).toBe(markdown);
  });

  it('copies edited generated children and manual checkpoint work as independent inline steps', async () => {
    const f = await fixture();
    const actor = { orgId: f.orgId, actorId: f.humanActorId, capabilities: ['contribute'] };
    const template = await createWorkTemplate(
      actor,
      WorkTemplateCreate.parse({
        targetType: 'project',
        definition: {
          name: 'Dinner',
          payload: { targetType: 'project' },
          blueprint: {
            steps: [
              {
                key: 'generated',
                kind: 'task',
                parentStepKey: null,
                sort: 0,
                fields: { title: 'Generated preparation' },
                template: null,
                actorRule: 'unassigned',
                teamRule: 'parent_team',
                cycleRule: 'none',
                dates: {},
                optional: { enabled: false, selectedByDefault: true },
              },
            ],
            dependencies: [],
          },
        },
      }),
    );
    await publishWorkTemplate(actor, template.id, template.draftRevision);
    const created = await f.app.request('/', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Actual dinner',
        teamId: f.teamId,
        workTypeId: template.id,
        targetDate: '2026-10-15',
      }),
    });
    expect(created.status).toBe(201);
    const source = (await created.json()) as { id: string };
    const root = one(
      await schema.db.select().from(schema.project).where(eq(schema.project.id, source.id)),
    );
    await schema.db
      .update(schema.task)
      .set({ description: '## Edited generated heading' })
      .where(eq(schema.task.projectId, root.id));
    const checkpoint = one(
      await schema.db
        .insert(schema.milestone)
        .values({
          organizationId: f.orgId,
          projectId: root.id,
          name: 'Venue booked',
          targetDate: new Date('2026-10-08'),
        })
        .returning(),
    );
    await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      projectId: root.id,
      milestoneId: checkpoint.id,
      title: 'Manual deposit',
      dueDate: new Date('2026-10-08'),
      state: 'todo',
    });
    const captured = await preview({ ...f, root });
    expect(captured.definition.blueprint.steps).toHaveLength(3);
    expect(captured.definition.blueprint.steps.every((step) => step.template === null)).toBe(true);
    expect(
      captured.definition.blueprint.steps.find(
        (step) => step.fields.description === '## Edited generated heading',
      ),
    ).toBeDefined();
    const deposit = captured.definition.blueprint.steps.find(
      (step) => step.kind === 'task' && step.fields.title === 'Manual deposit',
    );
    expect(deposit?.parentStepKey).not.toBeNull();
    if (deposit?.kind !== 'task') throw new Error('Captured Task missing');
    expect(deposit.dates.dueDate).toMatchObject({ offset: { days: 0, unit: 'calendar' } });
  });

  it('refuses a501-row source without silently truncating the private draft', async () => {
    const f = await fixture();
    await schema.db.insert(schema.task).values(
      Array.from({ length: 499 }, (_, index) => ({
        organizationId: f.orgId,
        teamId: f.teamId,
        projectId: f.root.id,
        title: `Extra ${index}`,
        state: 'todo' as const,
        statusId: f.statusId('task', 'todo'),
      })),
    );
    const response = await f.app.request(`/${f.root.id}/template/save-as/preview`, {
      method: 'POST',
    });
    expect(response.status).toBe(422);
    expect(
      await schema.db
        .select()
        .from(schema.template)
        .where(and(eq(schema.template.organizationId, f.orgId), eq(schema.template.isBase, false))),
    ).toEqual([]);
  });
});
