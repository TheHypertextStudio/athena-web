import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { TeamId } from '@docket/identity-access/ids';
import { InitiativeId, LabelId, WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';
import { appProvenance, originFor } from '../../src/lib/provenance/context';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
function step(key: string, extra: Record<string, unknown> = {}) {
  return BlueprintStep.parse({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: key },
    template: null,
    optional: { enabled: false, selectedByDefault: true },
    teamRule: 'parent_team',
    actorRule: 'creator',
    ...(extra['kind'] === undefined || extra['kind'] === 'task' ? { cycleRule: 'none' } : {}),
    dates: {},
    ...extra,
  });
}
const offset = (days: number) => ({
  kind: 'anchor',
  anchor: { kind: 'parent' },
  offset: { days, unit: 'calendar' },
});
async function fixture(steps: BlueprintStep[], kind: 'project' | 'initiative' = 'project') {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const { createWorkTemplate, publishWorkTemplate } =
    await import('../../src/lib/templates/service');
  const draft = await createWorkTemplate(caller, {
    targetType: kind,
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Event',
      payload: { targetType: kind },
      blueprint: { steps, dependencies: [] },
    }),
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  return { ...base, caller, published };
}
describe('transactional work-template expansion', () => {
  it('serves typed read-only previews without exposing child body text', async () => {
    const f = await fixture([
      step('prepare', {
        fields: { title: 'Prepare', description: 'Body is deliberately absent from summaries' },
      }),
    ]);
    const router = (await import('../../src/routes/templates')).default;
    const app = appWithActor(router, f.orgId, ['manage'], f.humanActorId);
    const response = await app.request(`/definitions/${f.published.id}/blueprint-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'project',
        body: { name: 'Dinner', teamId: f.teamId },
        options: { optionalChoices: [] },
      }),
    });
    expect(response.status).toBe(200);
    const { BlueprintCreationPreview } = await import('@docket/work/work-template-blueprint');
    const text = await response.text();
    expect(BlueprintCreationPreview.parse(JSON.parse(text)).descendants[0]?.title).toBe('Prepare');
    expect(text).not.toContain('Body is deliberately absent');
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('reviews optional children without inserting work and binds the whole request to acceptance', async () => {
    const f = await fixture([
      step('prepare'),
      step('extra', { sort: 1, optional: { enabled: true, selectedByDefault: false } }),
    ]);
    const command = {
      caller: f.caller,
      kind: 'project' as const,
      body: {
        name: 'Reviewed dinner',
        teamId: TeamId.parse(f.teamId),
        workTypeId: WorkTypeId.parse(f.published.id),
      },
      invocation: { origin: originFor('project_create', {}, appProvenance()) },
    };
    const { previewBlueprintCreation } =
      await import('../../src/lib/work-template-blueprints/preview');
    const { BlueprintPreviewOptions } = await import('@docket/work/work-template-blueprint');
    const options = BlueprintPreviewOptions.parse({
      optionalChoices: [{ path: ['extra'], selected: true }],
    });
    const preview = await schema.db.transaction((tx) =>
      previewBlueprintCreation(tx, command, options),
    );
    expect(preview.selectedCount).toBe(3);
    expect(preview.descendants.map(({ title, selected }) => ({ title, selected }))).toEqual([
      { title: 'prepare', selected: true },
      { title: 'extra', selected: true },
    ]);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(0);
    const { createWork } = await import('../../src/lib/work-creation/service');
    await expect(
      createWork({
        ...command,
        body: { ...command.body, milestones: [{ name: 'Unreviewed checkpoint' }] },
        blueprint: { ...options, previewToken: preview.previewToken },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'blueprint_preview_stale' });
    const created = await createWork({
      ...command,
      blueprint: { ...options, previewToken: preview.previewToken },
    });
    expect(created.created).toHaveLength(3);
  });
  it('checks contribute access to every Initiative association before creating the root', async () => {
    const f = await fixture([]);
    const initiatives = await schema.db
      .insert(schema.initiative)
      .values(
        ['Allowed', 'Read only'].map((name) => ({
          organizationId: f.orgId,
          name,
          statusId: f.statusId('initiative', 'active'),
        })),
      )
      .returning();
    const [first, second] = initiatives;
    if (!first || !second) throw new Error('Missing fixture');
    const [role] = await schema.db
      .insert(schema.role)
      .values({
        organizationId: f.orgId,
        key: 'contributor',
        name: 'Contributor',
        capabilities: ['contribute'],
        defaultVisibility: 'public',
      })
      .returning();
    if (!role) throw new Error('Missing fixture');
    await schema.db
      .update(schema.actor)
      .set({ roleId: role.id })
      .where(eq(schema.actor.id, f.humanActorId));
    await schema.db.delete(schema.grant).where(eq(schema.grant.subjectId, f.humanActorId));
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'initiative',
      resourceId: first.id,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    const { createWork } = await import('../../src/lib/work-creation/service');
    await expect(
      createWork({
        caller: f.caller,
        kind: 'project',
        body: {
          name: 'Requires both destinations',
          workTypeId: WorkTypeId.parse(f.published.id),
          initiativeIds: [InitiativeId.parse(first.id), InitiativeId.parse(second.id)],
        },
        invocation: { origin: originFor('project_create', {}, appProvenance()) },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('rolls back every generated row and its receipt when the last child insert fails', async () => {
    const f = await fixture([step('prepare', { sort: 0 }), step('finish', { sort: 1 })]);
    const { createWorkInTransaction } = await import('../../src/lib/work-creation/service');
    await expect(
      schema.db.transaction(async (tx) => {
        await tx.execute(
          sql`CREATE FUNCTION pg_temp.reject_final_blueprint_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title = 'finish' THEN RAISE EXCEPTION 'Final generated child rejected'; END IF; RETURN NEW; END $$`,
        );
        await tx.execute(
          sql`CREATE TRIGGER reject_final_blueprint_child BEFORE INSERT ON task FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_final_blueprint_child()`,
        );
        await createWorkInTransaction(tx, {
          caller: f.caller,
          kind: 'project',
          body: {
            name: 'Atomic preparation',
            teamId: TeamId.parse(f.teamId),
            workTypeId: WorkTypeId.parse(f.published.id),
          },
          invocation: { origin: originFor('project_create', {}, appProvenance()) },
        });
      }),
    ).rejects.toMatchObject({ cause: { message: 'Final generated child rejected' } });
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('drops a retired reusable child label with a bounded preview warning', async () => {
    const f = await fixture([
      step('prepare', {
        fields: { title: 'Prepare', labelIds: [LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')] },
      }),
    ]);
    const command = {
      caller: f.caller,
      kind: 'project' as const,
      body: {
        name: 'Dinner',
        teamId: TeamId.parse(f.teamId),
        workTypeId: WorkTypeId.parse(f.published.id),
      },
      invocation: { origin: originFor('project_create', {}, appProvenance()) },
    };
    const { prepareBlueprintCreation } =
      await import('../../src/lib/work-template-blueprints/preflight');
    await schema.db.transaction(async (tx) => {
      const preview = await prepareBlueprintCreation(tx, command);
      expect(preview.tree.warnings).toContainEqual({
        code: 'label_unavailable',
        paths: [['prepare']],
        count: 1,
      });
    });
    const { createWork } = await import('../../src/lib/work-creation/service');
    expect((await createWork(command)).created).toHaveLength(2);
    expect(
      await schema.db
        .select()
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('counts explicit checkpoints with a full selected blueprint before its first write', async () => {
    const f = await fixture(Array.from({ length: 499 }, (_, index) => step(`t${index}`)));
    const { createWork } = await import('../../src/lib/work-creation/service');
    await expect(
      createWork({
        caller: f.caller,
        kind: 'project',
        body: {
          name: 'Over budget',
          teamId: TeamId.parse(f.teamId),
          workTypeId: WorkTypeId.parse(f.published.id),
          milestones: [{ name: 'Extra checkpoint' }],
        },
        invocation: { origin: originFor('project_create', {}, appProvenance()) },
      }),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('restricts a private Program branch beneath a public Initiative', async () => {
    const f = await fixture(
      [
        step('community', {
          kind: 'program',
          fields: { name: 'Private community', visibility: 'private' },
        }),
        step('event', { kind: 'project', parentStepKey: 'community', fields: { name: 'Dinner' } }),
        step('prepare', { parentStepKey: 'event' }),
      ],
      'initiative',
    );
    const { createWork } = await import('../../src/lib/work-creation/service');
    const result = await createWork({
      caller: f.caller,
      kind: 'initiative',
      body: {
        name: 'Community initiative',
        workTypeId: WorkTypeId.parse(f.published.id),
        blueprint: { creationTeamId: TeamId.parse(f.teamId), optionalChoices: [] },
      },
      invocation: { origin: originFor('initiative_create', {}, appProvenance()) },
    });
    expect(result.created).toHaveLength(4);
    for (const created of result.created) {
      if (created.kind === 'program' || created.kind === 'project' || created.kind === 'task')
        expect(created.row.visibility).toBe('private');
    }
  });
  it('creates dated preparation and nested checkpoint work with one undo receipt', async () => {
    const f = await fixture([
      step('prepare', { dates: { dueDate: offset(-7) } }),
      step('venue', {
        kind: 'milestone',
        fields: { name: 'Venue' },
        dates: { targetDate: offset(-2) },
      }),
      step('confirm', { parentStepKey: 'venue', dates: { dueDate: offset(-1) } }),
    ]);
    const { createWork } = await import('../../src/lib/work-creation/service');
    const result = await createWork({
      caller: f.caller,
      kind: 'project',
      body: {
        name: 'Community dinner',
        teamId: TeamId.parse(f.teamId),
        targetDate: '2026-11-20',
        workTypeId: WorkTypeId.parse(f.published.id),
        workTypeVersionId: WorkTypeVersionId.parse(f.published.latestPublishedVersionId),
      },
      invocation: { origin: originFor('project_create', {}, appProvenance()) },
    });
    expect(result.created).toHaveLength(4);
    const tasks = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    const milestones = await schema.db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.organizationId, f.orgId));
    expect(tasks.find((row) => row.title === 'prepare')).toMatchObject({
      projectId: result.root.id,
      teamId: f.teamId,
      assigneeId: f.humanActorId,
      dueDate: new Date('2026-11-13'),
      blueprintParentKind: 'project',
      blueprintParentId: result.root.id,
    });
    expect(tasks.find((row) => row.title === 'confirm')).toMatchObject({
      projectId: result.root.id,
      milestoneId: milestones[0]?.id,
      dueDate: new Date('2026-11-17'),
      blueprintParentKind: 'milestone',
      blueprintParentId: milestones[0]?.id,
    });
    expect(milestones[0]?.targetDate).toEqual(new Date('2026-11-18'));
    expect(result.resolvedManifest).toHaveLength(3);
    if (result.root.kind !== 'project') throw new Error('Expected Project');
    expect(result.root.row.blueprintState?.lastApplicationChangeSetId).toBe(result.changeSetId);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(1);
    const entries = await schema.db
      .select()
      .from(schema.changeSetEntry)
      .where(eq(schema.changeSetEntry.changeSetId, result.changeSetId ?? ''));
    expect(entries.filter((row) => row.op === 'create')).toHaveLength(4);
  });

  it('refuses the whole create when a generated Task has no authorized destination team', async () => {
    const f = await fixture([step('prepare')]);
    const { createWork } = await import('../../src/lib/work-creation/service');
    await expect(
      createWork({
        caller: f.caller,
        kind: 'project',
        body: { name: 'Needs a team', workTypeId: WorkTypeId.parse(f.published.id) },
        invocation: { origin: originFor('project_create', {}, appProvenance()) },
      }),
    ).rejects.toMatchObject({ code: 'blueprint_destination_required' });
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
});
