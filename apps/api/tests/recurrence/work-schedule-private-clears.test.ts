import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import { compileScheduleCommand } from '../../src/lib/recurrence/schedule-compiler';
import { reviewBlueprintCreation } from '../../src/lib/work-template-blueprints/preflight';
import { getDb, one, seedTaskAccessOrg } from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
describe('persisted schedule child private nullable fields', () => {
  it.each([
    { label: 'null clear', fields: { summary: null }, expected: null },
    { label: 'authored blank', fields: { summary: '' }, expected: '' },
    { label: 'omitted summary', fields: {}, expected: 'Published child summary' },
  ])(
    'reviews, saves and creates a $label without inheriting a cleared publication value',
    async ({ fields, expected }) => {
      const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
      const caller = {
        orgId: base.orgId,
        actorId: base.humanActorId,
        roleId: null,
        capabilities: ['manage'],
      };
      const childDraft = await createWorkTemplate(caller, {
        targetType: 'task',
        scope: 'organization',
        offeredTeamIds: [],
        definition: WorkTemplateDefinition.parse({
          name: 'Preparation',
          payload: {
            targetType: 'task',
            title: 'Preparation',
            summary: 'Published child summary',
            description: 'Published child outline',
          },
        }),
      });
      const child = await publishWorkTemplate(caller, childDraft.id, childDraft.draftRevision);
      const rootDraft = await createWorkTemplate(caller, {
        targetType: 'project',
        scope: 'organization',
        offeredTeamIds: [],
        definition: WorkTemplateDefinition.parse({
          name: 'Dinner',
          payload: { targetType: 'project', name: 'Dinner' },
          blueprint: {
            steps: [
              {
                key: 'prepare',
                kind: 'task',
                parentStepKey: null,
                sort: 0,
                fields: { title: 'Prepare dinner' },
                template: { workTypeId: child.id, selection: { kind: 'latest' } },
                optional: { enabled: false, selectedByDefault: true },
                teamRule: 'parent_team',
                actorRule: 'unassigned',
                cycleRule: 'none',
                dates: {},
              },
            ],
            dependencies: [],
          },
        }),
      });
      const root = await publishWorkTemplate(caller, rootDraft.id, rootDraft.draftRevision);
      const document = WorkScheduleDraft.parse({
        kind: 'schedule',
        revision: 1,
        template: { targetType: 'project', workTypeId: root.id, selection: { kind: 'latest' } },
        titlePattern: '{month} Dinner',
        timezone: 'UTC',
        root: { kind: 'project', fields: {}, dates: {}, placement: {}, teamId: base.teamId },
        optionalChoices: [],
        stepOverrides: [
          { kind: 'task', path: ['prepare'], fields: { ...fields, description: '' } },
        ],
      });
      const saved = await createWorkSchedule(schema.db, {
        organizationId: base.orgId,
        actorId: base.humanActorId,
        name: 'Dinner',
        document,
        trigger: { kind: 'manual' },
        effectiveFrom: '2026-10-08',
      });
      await schema.db.transaction(async (tx) => {
        const batch = compileScheduleCommand({
          caller,
          seriesId: saved.series.id,
          ownerProgramId: null,
          document,
          runDate: '2026-10-08',
        });
        const command = batch.roots[0]?.command;
        if (!command) throw new Error('Missing schedule root');
        const reviewed = await reviewBlueprintCreation(tx, command, { optionalChoices: [] });
        expect(reviewed.tree.nodes[1]?.fields).toMatchObject({
          summary: expected,
          description: '',
        });
      });
      expect(
        (
          await executeScheduleOccurrence(schema.db, {
            organizationId: base.orgId,
            seriesId: saved.series.id,
            seriesRevisionId: saved.revision.id,
            scheduledFor: '2026-10-08',
          })
        ).status,
      ).toBe('materialized');
      const created = one(
        await schema.db
          .select()
          .from(schema.task)
          .where(
            and(eq(schema.task.organizationId, base.orgId), eq(schema.task.workTypeId, child.id)),
          ),
      );
      expect(created).toMatchObject({
        title: 'Prepare dinner',
        summary: expected,
        description: '',
      });
    },
  );
});
