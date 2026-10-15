import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { compileScheduleCommand } from '../../src/lib/recurrence/schedule-compiler';
import {
  executeScheduleOccurrence,
  retryScheduleOccurrence,
} from '../../src/lib/recurrence/schedule-runtime';
import { previewBlueprintCreation } from '../../src/lib/work-template-blueprints/preview';
import { prepareBlueprintCreation } from '../../src/lib/work-template-blueprints/preflight';
import * as creation from '../../src/lib/work-creation/service';
import { archiveWorkTemplate } from '../../src/lib/templates/service';
import { retainedFixture } from './work-template-adapter-fixture';
import { getDb, one } from '../support/routes-harness';
import { publication, republish } from '../support/work-template-archive-impact-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => vi.restoreAllMocks());

async function fixture(selected: boolean) {
  const f = await retainedFixture(schema);
  const branch = await publication(f, 'task', 'Nested branch', f.published);
  const parent = await publication(f, 'project', 'Optional project', branch, 'latest');
  const root = await republish(
    f,
    parent,
    WorkTemplateDefinition.parse({
      ...parent.draftDefinition,
      blueprint: {
        ...parent.draftDefinition.blueprint,
        steps: parent.draftDefinition.blueprint.steps.map((step) => ({
          ...step,
          optional: { enabled: true, selectedByDefault: !selected },
        })),
      },
    }),
  );
  const document = WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: root.id, selection: { kind: 'latest' } },
    titlePattern: '{month} Project',
    timezone: 'UTC',
    root: { kind: 'project', fields: {}, dates: {}, placement: {}, teamId: f.teamId },
    stepOverrides: [],
    optionalChoices: [{ path: ['child'], selected }],
  });
  return { ...f, branch, root, document };
}
describe('trusted private schedule optional selections', () => {
  it.each([false, true])(
    'previews, saves and retries a frozen selected=%s nested subtree',
    async (selected) => {
      const f = await fixture(selected);
      const batch = compileScheduleCommand({
        caller: f.caller,
        seriesId: f.series.id,
        ownerProgramId: null,
        document: f.document,
        runDate: '2026-10-15',
      });
      const command = batch.roots[0]?.command;
      if (!command) throw new Error('Missing root');
      const preview = await schema.db.transaction((tx) =>
        previewBlueprintCreation(tx, command, { optionalChoices: f.document.optionalChoices }),
      );
      expect(preview.selectedCount).toBe(selected ? 3 : 1);
      expect(preview.descendants.map((node) => node.selected)).toEqual([selected, selected]);
      const saved = await createWorkSchedule(schema.db, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        name: 'Optional private routine',
        effectiveFrom: '2026-10-15',
        trigger: { kind: 'manual' },
        document: f.document,
      });
      const original = creation.createWorkBatchInTransaction;
      vi.spyOn(creation, 'createWorkBatchInTransaction').mockImplementationOnce(
        async (tx, input) => {
          await original(tx, input);
          throw new Error('Injected rollback after optional work writes');
        },
      );
      const failed = await executeScheduleOccurrence(schema.db, {
        organizationId: f.orgId,
        seriesId: saved.series.id,
        seriesRevisionId: saved.revision.id,
        scheduledFor: '2026-10-16',
      });
      expect(failed.status).toBe('failed');
      const before = one(
        await schema.db
          .select()
          .from(schema.processOccurrence)
          .where(eq(schema.processOccurrence.id, failed.occurrenceId)),
      );
      expect(before.acceptedClaim?.roots[0]?.selectedPaths).toHaveLength(selected ? 3 : 1);
      expect(before.acceptedClaim?.roots[0]?.optionalChoices).toEqual(f.document.optionalChoices);
      expect(
        await schema.db
          .select()
          .from(schema.project)
          .where(eq(schema.project.organizationId, f.orgId)),
      ).toHaveLength(0);
      await republish(
        f,
        f.branch,
        WorkTemplateDefinition.parse({
          name: 'Branch v2 without children',
          payload: { targetType: 'task', title: 'Changed' },
        }),
      );
      await archiveWorkTemplate(f.caller, f.root.id);
      const retried = await retryScheduleOccurrence(schema.db, {
        organizationId: f.orgId,
        occurrenceId: failed.occurrenceId,
      });
      expect(retried.status).toBe('materialized');
      const after = one(
        await schema.db
          .select()
          .from(schema.processOccurrence)
          .where(eq(schema.processOccurrence.id, failed.occurrenceId)),
      );
      expect(after.acceptedClaim).toEqual(before.acceptedClaim);
      expect(
        await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
      ).toHaveLength(selected ? 2 : 0);
    },
  );
  it('keeps ordinary public explicit choices behind the required creation preview token', async () => {
    const f = await fixture(true);
    const command = compileScheduleCommand({
      caller: f.caller,
      seriesId: f.series.id,
      ownerProgramId: null,
      document: f.document,
      runDate: '2026-10-15',
    }).roots[0]?.command;
    if (!command) throw new Error('Missing root');
    const { scheduleContext: _private, ...invocation } = command.invocation;
    await expect(
      schema.db.transaction((tx) => prepareBlueprintCreation(tx, { ...command, invocation })),
    ).rejects.toThrow('Review optional child choices before creation.');
    await expect(
      schema.db.transaction((tx) =>
        prepareBlueprintCreation(tx, {
          ...command,
          invocation,
          blueprint: {
            ...command.blueprint,
            optionalChoices: f.document.optionalChoices,
            previewToken: `sha256:${'0'.repeat(64)}`,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'blueprint_preview_stale' });
  });
});
