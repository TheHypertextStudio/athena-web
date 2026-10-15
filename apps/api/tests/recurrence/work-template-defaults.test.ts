/** Process authoring applies template defaults before normalizing omitted input fields. */
import type * as DbModule from '@docket/db';
import { ProcessDefinitionId } from '@docket/work/ids';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProcessDefinitionCreate, RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import { getMigratedDb } from '../support/db';
import { seedLabel } from '../mcp/mcp-catalog-harness';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';

let schema!: typeof DbModule;
beforeAll(async () => {
  schema = await getMigratedDb();
});

describe('process work-template starting defaults', () => {
  it('preserves priority and label omissions in the validated create input', () => {
    const input = ProcessDefinitionCreate.parse({
      name: 'Review',
      tasks: [{ key: 'review', title: 'Review', teamId: '01M3ZE8NXAHRAW9ED8M12345FM' }],
    });
    expect(input.tasks[0]?.priority).toBeUndefined();
    expect(input.tasks[0]?.labelIds).toBeUndefined();
  });

  it.each(['create', 'revision'] as const)(
    'inherits priority and labels during %s while preserving explicit empty overrides',
    async (operation) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const labelId = await seedLabel(schema.db, schema, seed, { name: `Required ${operation}` });
      const { createWorkTemplate } = await import('../../src/lib/templates/service');
      const template = await createWorkTemplate(
        { orgId: seed.orgId, actorId: seed.actorId },
        WorkTemplateCreate.parse({
          targetType: 'task',
          scope: 'organization',
          definition: {
            name: 'Review outline',
            payload: {
              targetType: 'task',
              priority: 'high',
              labelIds: [labelId],
              description: '## Review',
            },
          },
        }),
        { publish: true },
      );
      const {
        createPublishedProcessDefinition,
        appendPublishedProcessRevision,
        loadProcessDefinitionDetail,
      } = await import('../../src/lib/recurrence/process-definition');
      const definition = ProcessDefinitionCreate.parse({
        name: 'Review process',
        tasks: [
          {
            key: 'inherited',
            title: `${operation} inherited`,
            teamId: seed.teamId,
            workTypeId: template.id,
          },
          {
            key: 'explicit',
            title: `${operation} explicit`,
            teamId: seed.teamId,
            workTypeId: template.id,
            priority: 'none',
            labelIds: [],
          },
        ],
      });
      const context = { organizationId: seed.orgId, actorId: seed.actorId };
      const initial =
        operation === 'revision'
          ? ProcessDefinitionCreate.parse({
              name: 'Review process',
              tasks: [{ key: 'original', title: 'Original step', teamId: seed.teamId }],
            })
          : definition;
      const created = await createPublishedProcessDefinition(schema.db, {
        ...context,
        definition: initial,
      });
      if (operation === 'revision')
        await appendPublishedProcessRevision(schema.db, {
          ...context,
          definitionId: created.definitionId,
          revision: definition,
        });
      const detail = await loadProcessDefinitionDetail(
        schema.db,
        seed.orgId,
        created.definitionId,
        seed.actorId,
      );
      expect(detail.revision.tasks[0]).toMatchObject({
        priority: 'high',
        labelIds: [labelId],
        workTypeId: template.id,
        workTypeVersionId: template.latestPublishedVersionId,
      });
      expect(detail.revision.tasks[1]).toMatchObject({ priority: 'none', labelIds: [] });
      const { createScheduledProcess } = await import('../../src/lib/recurrence/authoring');
      await createScheduledProcess(schema.db, {
        ...context,
        now: new Date('2026-10-14T12:00:00Z'),
        series: RecurrenceSeriesCreate.parse({
          processDefinitionId: ProcessDefinitionId.parse(created.definitionId),
          name: 'Review run',
          effectiveFrom: '2026-10-14',
          trigger: { kind: 'after_completion', interval: 1, unit: 'week' },
        }),
      });
      const tasks = await schema.db
        .select()
        .from(schema.task)
        .where(eq(schema.task.organizationId, seed.orgId));
      const inherited = tasks.find((row) => row.title === `${operation} inherited`);
      const explicit = tasks.find((row) => row.title === `${operation} explicit`);
      expect(inherited?.priority).toBe('high');
      expect(explicit?.priority).toBe('none');
      const labels = await schema.db
        .select()
        .from(schema.taskLabel)
        .where(
          and(
            eq(schema.taskLabel.organizationId, seed.orgId),
            eq(schema.taskLabel.taskId, inherited?.id ?? ''),
          ),
        );
      expect(labels.map((row) => row.labelId)).toEqual([labelId]);
      expect(
        await schema.db
          .select()
          .from(schema.taskLabel)
          .where(eq(schema.taskLabel.taskId, explicit?.id ?? '')),
      ).toHaveLength(0);
    },
  );
});
