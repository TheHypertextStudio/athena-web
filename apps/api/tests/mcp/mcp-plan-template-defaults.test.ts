/** Applied template defaults must survive confirmation into ordinary work. */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import { LabelId } from '@docket/work/ids';
import type { TemplateDraft } from '@docket/work/template-contract';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { body, closeCatalogClients, connectCatalog, seedLabel } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let registerTools!: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

describe('plan template defaults', () => {
  it('persists all four kinds of template properties and explicit overrides', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const labelId = await seedLabel(schema.db, schema, seed, {
      name: 'Plan label',
      teamId: seed.teamId,
    });
    const drafts: TemplateDraft[] = [
      {
        targetType: 'initiative',
        summary: 'Strategy summary',
        status: 'proposed',
        priority: 'high',
        updateCadence: 'weekly',
        health: 'at_risk',
      },
      {
        targetType: 'program',
        summary: 'Program summary',
        status: 'paused',
        health: 'at_risk',
        visibility: 'private',
      },
      { targetType: 'project', summary: 'Project summary', status: 'active', health: 'at_risk' },
      { targetType: 'task', priority: 'urgent', labelIds: [LabelId.parse(labelId)] },
    ];
    const templates = await schema.db
      .insert(schema.template)
      .values(
        drafts.map((draft) => ({
          organizationId: seed.orgId,
          ownerActorId: seed.actorId,
          scope: 'personal' as const,
          name: `Plan ${draft.targetType}`,
          targetType: draft.targetType,
          payload: { ...draft, description: `## ${draft.targetType}\n\nFill this in.  \n` },
        })),
      )
      .returning();
    const client = await connectCatalog(registerTools, seed.ctx);
    const started = body<{ planId: string }>(
      await client.callTool({ name: 'plan_start', arguments: { orgId: seed.orgId } }),
    );
    const ops = templates.flatMap((saved, index) => [
      {
        op: 'upsert_node',
        node: {
          ref: String(index),
          kind: saved.targetType,
          ...(index === 0 ? {} : { parentRef: String(index - 1) }),
          fields: {
            title: `Confirmed ${saved.targetType}`,
            ...(saved.targetType === 'project'
              ? { summary: 'Explicit summary', teamId: seed.teamId }
              : {}),
          },
        },
      },
      { op: 'apply_template', ref: String(index), templateId: saved.id },
    ]);
    const drafted = await client.callTool({
      name: 'plan_draft',
      arguments: { planId: started.planId, revision: 0, ops },
    });
    expect(drafted.isError).not.toBe(true);
    const committed = await client.callTool({
      name: 'plan_commit',
      arguments: { planId: started.planId, refs: ['3'] },
    });
    expect(committed.isError, JSON.stringify(committed)).not.toBe(true);
    const placed = body<{ placed: { kind: string; id: string }[] }>(committed).placed;
    const id = (kind: string): string =>
      assertDefined(placed.find((entry) => entry.kind === kind)).id;
    const [initiative] = await schema.db
      .select()
      .from(schema.initiative)
      .where(eq(schema.initiative.id, id('initiative')));
    const [program] = await schema.db
      .select()
      .from(schema.program)
      .where(eq(schema.program.id, id('program')));
    const [project] = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, id('project')));
    const [task] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, id('task')));
    expect(initiative).toMatchObject({
      summary: 'Strategy summary',
      status: 'proposed',
      priority: 'high',
      updateCadence: 'weekly',
      health: 'at_risk',
    });
    expect(program).toMatchObject({
      summary: 'Program summary',
      status: 'paused',
      health: 'at_risk',
      visibility: 'private',
    });
    expect(project).toMatchObject({
      summary: 'Explicit summary',
      status: 'active',
      health: 'at_risk',
    });
    expect(task).toMatchObject({
      priority: 'urgent',
      templateId: templates[3]?.id,
      description: '## task\n\nFill this in.  \n',
    });
    const labels = await schema.db
      .select()
      .from(schema.taskLabel)
      .where(eq(schema.taskLabel.taskId, id('task')));
    expect(labels.map((label) => label.labelId)).toEqual([labelId]);
  });

  it.each([false, true])(
    'plan_commit requires read scope before returning template content with reference=%s',
    async (referenced) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const [saved] = await schema.db
        .insert(schema.template)
        .values({
          organizationId: seed.orgId,
          ownerActorId: seed.actorId,
          scope: 'personal',
          name: 'Private outline',
          targetType: 'project',
          payload: { targetType: 'project', description: 'Private template body' },
        })
        .returning();
      const author = await connectCatalog(registerTools, seed.ctx);
      const started = body<{ planId: string }>(
        await author.callTool({ name: 'plan_start', arguments: { orgId: seed.orgId } }),
      );
      const drafted = await author.callTool({
        name: 'plan_draft',
        arguments: {
          planId: started.planId,
          revision: 0,
          ops: [
            {
              op: 'upsert_node',
              node: { ref: 'i', kind: 'initiative', fields: { title: 'Scope strategy' } },
            },
            {
              op: 'upsert_node',
              node: {
                ref: 'p',
                kind: 'project',
                parentRef: 'i',
                fields: { title: 'Scope project' },
                ...(referenced ? { templateId: assertDefined(saved).id } : {}),
              },
            },
          ],
        },
      });
      expect(drafted.isError).not.toBe(true);
      const writer = await connectCatalog(registerTools, { ...seed.ctx, scopes: ['work:write'] });
      const committed = await writer.callTool({
        name: 'plan_commit',
        arguments: { planId: started.planId, refs: ['p'] },
      });
      expect(committed.isError).toBe(true);
      expect(JSON.stringify(committed)).toContain('required scope: work:read');
      expect(JSON.stringify(committed)).not.toContain('Private template body');
    },
  );
});
