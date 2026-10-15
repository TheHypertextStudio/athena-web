import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintPreviewOptions } from '@docket/work/work-template-blueprint';
import { InitiativeCreate } from '@docket/work/initiative-contract';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { createWork } from '../../src/lib/work-creation/service';
import {
  createWorkTemplate,
  publishWorkTemplate,
  editWorkTemplateDraft,
} from '../../src/lib/templates/service';
import { previewBlueprintCreation } from '../../src/lib/work-template-blueprints/preview';
import { previewWorkTemplateCapture } from '../../src/lib/work-template-blueprints/capture';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { getDb } from '../support/routes-harness';
import { defaultScheduleFixture } from './program-default-schedules-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function owned(programId: string) {
  return schema.db
    .select({ series: schema.recurrenceSeries, revision: schema.recurrenceSeriesRevision })
    .from(schema.recurrenceSeries)
    .innerJoin(
      schema.recurrenceSeriesRevision,
      eq(schema.recurrenceSeriesRevision.seriesId, schema.recurrenceSeries.id),
    )
    .where(eq(schema.recurrenceSeries.ownerProgramId, programId));
}
describe('transactional independent Program default schedules', () => {
  it('reviews the destination and first run and installs independent copies for each Program', async () => {
    const f = await defaultScheduleFixture(schema);
    const preview = await schema.db.transaction((tx) =>
      previewBlueprintCreation(tx, f.command, BlueprintPreviewOptions.parse(f.command.blueprint)),
    );
    expect(preview.defaultSchedules[0]).toMatchObject({
      programPath: [],
      programName: 'Community dinners',
      name: 'Community dinner',
      cadenceKind: 'monthly',
      selection: 'latest',
    });
    expect(preview.defaultSchedules[0]?.firstRunDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const a = await createWork(f.command),
      b = await createWork(f.command);
    const [left] = await owned(a.root.id),
      [right] = await owned(b.root.id);
    expect(left?.series.id).not.toBe(right?.series.id);
    expect(left?.revision.id).not.toBe(right?.revision.id);
    expect(left?.series.createdBy).toBe(f.caller.actorId);
    expect(WorkScheduleDraft.parse(left?.revision.scheduleDraft).root.responsibleActorId).toBe(
      f.caller.actorId,
    );
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ name: 'Edited only here' })
      .where(eq(schema.recurrenceSeries.id, left?.series.id ?? 'missing'));
    expect((await owned(b.root.id))[0]?.series.name).toBe('Community dinner');
  });
  it('rolls back the entire Program tree if any default schedule can no longer pass preflight', async () => {
    const f = await defaultScheduleFixture(schema);
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, f.project.id));
    await expect(createWork(f.command)).rejects.toMatchObject({ status: 404 });
    expect(
      await schema.db
        .select()
        .from(schema.program)
        .where(eq(schema.program.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db
        .select()
        .from(schema.recurrenceSeries)
        .where(eq(schema.recurrenceSeries.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('installs defaults on a nested newly created Program through the same writer', async () => {
    const f = await defaultScheduleFixture(schema);
    const draft = await createWorkTemplate(f.caller, {
      targetType: 'initiative',
      scope: 'organization',
      offeredTeamIds: [],
      definition: WorkTemplateDefinition.parse({
        name: 'Community',
        payload: { targetType: 'initiative' },
        blueprint: {
          steps: [
            {
              key: 'dinners',
              kind: 'program',
              parentStepKey: null,
              sort: 0,
              fields: { name: 'Nested dinners' },
              optional: { enabled: false, selectedByDefault: true },
              template: { workTypeId: f.published.id, selection: { kind: 'latest' } },
              teamRule: 'none',
              actorRule: 'creator',
              dates: {},
            },
          ],
          dependencies: [],
        },
      }),
    });
    await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
    const created = await createWork({
      caller: f.caller,
      kind: 'initiative',
      body: InitiativeCreate.parse({ name: 'Community', workTypeId: draft.id }),
      invocation: { origin: originFor('initiative_create', {}, appProvenance()) },
      blueprint: f.command.blueprint,
    });
    const nested = created.created.find((work) => work.kind === 'program');
    expect(nested).toBeDefined();
    expect(await owned(nested?.id ?? 'missing')).toHaveLength(1);
  });
  it('captures reusable outlines and leaves existing Program copies unchanged after template edits', async () => {
    const f = await defaultScheduleFixture(schema);
    const created = await createWork(f.command);
    const before = await owned(created.root.id);
    const capture = await previewWorkTemplateCapture(f.caller, 'program', created.root.id);
    expect(capture.definition.defaultSchedules).toHaveLength(1);
    expect(capture.definition.defaultSchedules[0]?.actorRule).toBe('parent_responsible');
    const updated = await editWorkTemplateDraft(f.caller, f.published.id, {
      expectedRevision: f.published.draftRevision,
      definition: WorkTemplateDefinition.parse({
        ...f.published.draftDefinition,
        defaultSchedules: [],
      }),
    });
    await publishWorkTemplate(f.caller, updated.id, updated.draftRevision);
    expect(await owned(created.root.id)).toEqual(before);
  });
});
