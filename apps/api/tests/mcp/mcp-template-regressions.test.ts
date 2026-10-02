/** Public MCP regressions for template permission, catalog, label, and confirmation behavior. */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import type { TemplateDraft } from '@docket/work/template-contract';
import { LabelId } from '@docket/work/ids';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  seedLabel,
  seedLabelGroup,
} from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let registerTools!: typeof RegisterTools;
type Seed = Awaited<ReturnType<typeof seedMcpUpdateOrg>>;

beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

/** Save a reusable draft without invoking the creation tools under test. */
async function saveTemplate(seed: Seed, payload: TemplateDraft): Promise<string> {
  const [saved] = await schema.db
    .insert(schema.template)
    .values({
      organizationId: seed.orgId,
      ownerActorId: seed.actorId,
      name: `Review ${payload.targetType}`,
      targetType: payload.targetType,
      scope: 'personal',
      payload,
    })
    .returning();
  return assertDefined(saved).id;
}

/** The smallest undecided creation arguments for each direct tool. */
function creationArguments(seed: Seed, name: string, template?: string): Record<string, unknown> {
  if (name === 'capture') return { orgId: seed.orgId, text: 'Scoped capture', template };
  if (name === 'organize') {
    return {
      orgId: seed.orgId,
      items: [{ ref: 't', kind: 'task', title: 'Scoped organize', template }],
    };
  }
  return {
    orgId: seed.orgId,
    template,
    recurringTask: {
      task: { title: 'Scoped recurrence', teamId: seed.teamId },
      schedule: { kind: 'after_completion', interval: 1, unit: 'day' },
    },
  };
}

describe('template creation regressions', () => {
  it.each(
    ['capture', 'organize', 'repeat_task'].flatMap((name) => [
      { name, selected: false },
      { name, selected: true },
    ]),
  )(
    '$name refuses template disclosure to write-only tokens with selected=$selected',
    async ({ name, selected }) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const template = await saveTemplate(seed, {
        targetType: 'task',
        description: 'Private template content',
      });
      const client = await connectCatalog(registerTools, { ...seed.ctx, scopes: ['work:write'] });
      const result = await client.callTool({
        name,
        arguments: creationArguments(seed, name, selected ? template : undefined),
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('required scope: work:read');
      expect(JSON.stringify(result)).not.toContain('Private template content');
      expect(
        await schema.db
          .select()
          .from(schema.task)
          .where(eq(schema.task.organizationId, seed.orgId)),
      ).toHaveLength(0);
    },
  );

  it('permits a write-only caller to deliberately capture freeform work', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    await saveTemplate(seed, { targetType: 'task', description: 'Private template content' });
    const client = await connectCatalog(registerTools, { ...seed.ctx, scopes: ['work:write'] });
    const result = await client.callTool({
      name: 'capture',
      arguments: {
        orgId: seed.orgId,
        text: 'Freeform task',
        withoutTemplateReason: 'The user requested quick capture.',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(body(result)).toMatchObject({
      items: [{ title: 'Freeform task', description: 'Freeform task' }],
    });
    expect(JSON.stringify(result)).not.toContain('Private template content');
  });

  it('shares full template bodies across unresolved items in a large plan', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    await schema.db.insert(schema.template).values(
      Array.from({ length: 20 }, (_, index) => ({
        organizationId: seed.orgId,
        ownerActorId: seed.actorId,
        name: `Outline ${index}`,
        targetType: 'task' as const,
        scope: 'personal' as const,
        payload: { targetType: 'task' as const, description: '## Work\n' + 'x'.repeat(5000) },
      })),
    );
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: Array.from({ length: 200 }, (_, index) => ({
          ref: String(index),
          kind: 'task',
          title: `Task ${index}`,
        })),
      },
    });
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    const response = body<{
      templates: unknown[];
      catalogs: { id: string }[];
      choices: { catalogId: string }[];
    }>(result);
    expect(result.isError).toBe(true);
    expect(text.length).toBeLessThan(250_000);
    expect(response.templates).toHaveLength(20);
    expect(response.catalogs).toHaveLength(1);
    expect(response.choices).toHaveLength(200);
    expect(new Set(response.choices.map((choice) => choice.catalogId))).toEqual(
      new Set(response.catalogs.map((catalog) => catalog.id)),
    );
  });

  it.each(['capture', 'organize'])(
    '%s preserves default label precedence after a group becomes exclusive',
    async (name) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const groupId = await seedLabelGroup(schema.db, schema, seed, {
        name: 'Kind',
        exclusive: false,
      });
      const first = await seedLabel(schema.db, schema, seed, { name: 'First', groupId });
      const second = await seedLabel(schema.db, schema, seed, { name: 'Second', groupId });
      const template = await saveTemplate(seed, {
        targetType: 'task',
        labelIds: [LabelId.parse(second), LabelId.parse(first)],
      });
      await schema.db
        .update(schema.labelGroup)
        .set({ exclusive: true })
        .where(eq(schema.labelGroup.id, groupId));
      const client = await connectCatalog(registerTools, seed.ctx);
      const args =
        name === 'capture'
          ? { orgId: seed.orgId, text: 'Ordered defaults', template }
          : {
              orgId: seed.orgId,
              items: [{ ref: 't', kind: 'task', title: 'Ordered defaults', template }],
            };
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      const [created] = await schema.db
        .select()
        .from(schema.task)
        .where(eq(schema.task.organizationId, seed.orgId));
      const labels = await schema.db
        .select()
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.taskId, assertDefined(created).id));
      expect(labels.map((label) => label.labelId)).toEqual([first]);
    },
  );

  it.each([false, true])('accepts a project team label with template=%s', async (templated) => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const labelId = await seedLabel(schema.db, schema, seed, {
      name: 'Team label',
      teamId: seed.teamId,
    });
    const decision = templated
      ? { template: await saveTemplate(seed, { targetType: 'project', description: '## Work' }) }
      : { withoutTemplateReason: 'The user requested a freeform project.' };
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'organize',
      arguments: {
        orgId: seed.orgId,
        items: [
          {
            ref: 'p',
            kind: 'project',
            title: 'Team labeled project',
            team: seed.teamId,
            labelIds: [labelId],
            ...decision,
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    const [created] = await schema.db
      .select()
      .from(schema.project)
      .where(
        and(
          eq(schema.project.organizationId, seed.orgId),
          eq(schema.project.name, 'Team labeled project'),
        ),
      );
    const labels = await schema.db
      .select()
      .from(schema.projectLabel)
      .where(eq(schema.projectLabel.projectId, assertDefined(created).id));
    expect(labels.map((label) => label.labelId)).toEqual([labelId]);
  });
});
