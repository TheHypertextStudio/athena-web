/** Template discovery and reuse through the public MCP protocol. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { LabelId } from '@docket/work/ids';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  joinTeam,
  seedLabel,
  seedSecondTeam,
} from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

type Seed = Awaited<ReturnType<typeof seedMcpUpdateOrg>>;
interface CatalogPage {
  templates: { id: string; name: string; targetType: string; payload: { description?: string } }[];
  nextCursor: string | null;
}

/** Store one draft with the visibility boundary the scenario needs. */
async function seedTemplate(
  seed: Seed,
  values: Partial<typeof schema.template.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.template)
    .values({
      organizationId: seed.orgId,
      ownerActorId: seed.actorId,
      name: 'Weekly review',
      targetType: 'task',
      scope: 'personal',
      payload: { targetType: 'task', description: '## Review', priority: 'high' },
      ...values,
    })
    .returning({ id: schema.template.id });
  if (!row) throw new Error('Template seed failed');
  return row.id;
}

describe('MCP template discovery', () => {
  it('sends the template workflow on initialization without requesting a prompt', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view']);
    const { buildServer } = await import('../../src/mcp/server');
    const server = buildServer(seed.ctx);
    const client = new Client({ name: 'template-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      expect(client.getInstructions()).toContain('Generally use a fitting template');
      expect(client.getInstructions()).toContain('list_templates');
      expect(client.getInstructions()).toContain('apply_template');
      const prompt = await client.getPrompt({ name: 'docket_system' });
      expect(prompt.messages[0]?.content).toMatchObject({
        text: expect.stringContaining('Generally use a fitting template'),
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('lists only visible templates with payloads and filters by target kind', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view']);
    await joinTeam(db, schema, seed, seed.teamId);
    const otherTeam = await seedSecondTeam(db, schema, seed);
    const own = await seedTemplate(seed);
    const workspace = await seedTemplate(seed, { name: 'Shared', scope: 'organization' });
    const team = await seedTemplate(seed, { name: 'Core', scope: 'team', teamId: seed.teamId });
    await seedTemplate(seed, { name: 'Hidden personal', ownerActorId: seed.sarahId });
    await seedTemplate(seed, { name: 'Hidden team', scope: 'team', teamId: otherTeam });
    await seedTemplate(seed, {
      name: 'Project',
      targetType: 'project',
      payload: { targetType: 'project' },
    });
    const foreign = await seedMcpUpdateOrg(db, schema, ['view']);
    await seedTemplate(foreign, { scope: 'organization' });
    const client = await connectCatalog(registerTools, { ...seed.ctx, scopes: ['work:read'] });
    const page = body<CatalogPage>(
      await client.callTool({
        name: 'list_templates',
        arguments: { orgId: seed.orgId, targetType: 'task' },
      }),
    );
    expect(page.templates.map((t) => t.id).sort()).toEqual([own, workspace, team].sort());
    expect(page.templates[0]?.payload.description).toBe('## Review');
    expect(page.nextCursor).toBeNull();
  });

  it('paginates without duplicates and refuses a cursor from another workspace or filter', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view']);
    await seedTemplate(seed);
    await seedTemplate(seed, { name: 'Second' });
    const client = await connectCatalog(registerTools, seed.ctx);
    const first = body<CatalogPage>(
      await client.callTool({ name: 'list_templates', arguments: { orgId: seed.orgId, limit: 1 } }),
    );
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = body<CatalogPage>(
      await client.callTool({
        name: 'list_templates',
        arguments: { orgId: seed.orgId, limit: 1, cursor: first.nextCursor },
      }),
    );
    expect(second.templates[0]?.id).not.toBe(first.templates[0]?.id);
    expect(second.nextCursor).toBeNull();
    const foreign = await seedMcpUpdateOrg(db, schema, ['view']);
    const otherClient = await connectCatalog(registerTools, foreign.ctx);
    expect(
      (
        await otherClient.callTool({
          name: 'list_templates',
          arguments: { orgId: foreign.orgId, cursor: first.nextCursor },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'list_templates',
          arguments: { orgId: seed.orgId, targetType: 'task', cursor: first.nextCursor },
        })
      ).isError,
    ).toBe(true);
  });

  it('returns literal Markdown bodies for every supported kind through discovery and both plan reads', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);
    for (const targetType of ['task', 'project', 'initiative', 'program'] as const) {
      const markdown = `## ${targetType} outcome\n\n- Keep this structure.  \n\n## Evidence\n`;
      await seedTemplate(seed, {
        name: `${targetType} brief`,
        targetType,
        payload: { targetType, description: markdown },
      });
      const page = body<CatalogPage>(
        await client.callTool({
          name: 'list_templates',
          arguments: { orgId: seed.orgId, targetType },
        }),
      );
      expect(page.templates).toHaveLength(1);
      expect(page.templates[0]?.payload.description).toBe(markdown);
    }
    const start = body<{ planId: string; templates: { targetType: string; body: string }[] }>(
      await client.callTool({ name: 'plan_start', arguments: { orgId: seed.orgId } }),
    );
    expect(start.templates).toHaveLength(4);
    for (const entry of start.templates) {
      expect(entry.body).toBe(
        `## ${entry.targetType} outcome\n\n- Keep this structure.  \n\n## Evidence\n`,
      );
    }
    const read = body<{ templates: unknown[] }>(
      await client.callTool({ name: 'plan_read', arguments: { planId: start.planId } }),
    );
    expect(read.templates).toEqual(start.templates);
    const items = start.templates.map((entry) => ({
      ref: entry.targetType,
      kind: entry.targetType,
      title: `Templated ${entry.targetType}`,
      description: entry.body.replace('Keep this structure.', 'Deliver the October review.'),
    }));
    const created = body<{ placed: { kind: string; id: string }[] }>(
      await client.callTool({ name: 'organize', arguments: { orgId: seed.orgId, items } }),
    );
    const tables = {
      task: schema.task,
      project: schema.project,
      initiative: schema.initiative,
      program: schema.program,
    };
    for (const kind of ['task', 'project', 'initiative', 'program'] as const) {
      const placed = created.placed.find((entry) => entry.kind === kind);
      if (!placed) throw new Error(`Missing ${kind}`);
      const table = tables[kind];
      const [row] = await db
        .select({ description: table.description })
        .from(table)
        .where(eq(table.id, placed.id));
      expect(row?.description).toBe(
        `## ${kind} outcome\n\n- Deliver the October review.  \n\n## Evidence\n`,
      );
    }
  });

  it('offers shipped defaults on the first read of a workspace without templates', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view']);
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = body<CatalogPage>(
      await client.callTool({ name: 'list_templates', arguments: { orgId: seed.orgId } }),
    );
    expect(new Set(result.templates.map((t) => t.targetType))).toEqual(
      new Set(['task', 'project', 'initiative', 'program']),
    );
    expect(result.templates.every((t) => typeof t.payload.description === 'string')).toBe(true);
  });

  it('puts the template-body instruction in creation tool descriptions for clients that only read tools', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);
    const { tools } = await client.listTools();
    for (const name of ['capture', 'organize']) {
      const description = tools.find((t) => t.name === name)?.description;
      expect(description).toContain('list_templates');
      expect(description).toContain('Markdown');
      expect(description).toContain('instead of inventing a format');
    }
    expect(tools.find((t) => t.name === 'organize')?.description).toContain(
      'tasks, projects, initiatives, or programs',
    );
  });

  it('requires read scope and workspace view access', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, []);
    const client = await connectCatalog(registerTools, seed.ctx);
    expect(
      (await client.callTool({ name: 'list_templates', arguments: { orgId: seed.orgId } })).isError,
    ).toBe(true);
    const writable = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const noRead = await connectCatalog(registerTools, { ...writable.ctx, scopes: ['work:write'] });
    expect(
      (await noRead.callTool({ name: 'list_templates', arguments: { orgId: writable.orgId } }))
        .isError,
    ).toBe(true);
  });
});

describe('repeating tasks from templates', () => {
  it('uses a discovered template ID and preserves authored text and explicit fields', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const labelId = await seedLabel(db, schema, seed, { name: 'Review' });
    const id = await seedTemplate(seed, {
      payload: {
        targetType: 'task',
        title: 'Default title',
        description: '## Review',
        priority: 'high',
        labelIds: [LabelId.parse(labelId)],
      },
    });
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'repeat_task',
      arguments: {
        orgId: seed.orgId,
        template: id,
        recurringTask: {
          task: {
            teamId: seed.teamId,
            title: 'My review',
            description: '## Review\n\nKeep this.  ',
            priority: 'low',
          },
          schedule: { kind: 'after_completion', interval: 1, unit: 'week' },
        },
      },
    });
    expect(result.isError).not.toBe(true);
    const created = body<{ firstTask: { id: string } }>(result);
    const [row] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, created.firstTask.id));
    expect(row).toMatchObject({
      title: 'My review',
      description: '## Review\n\nKeep this.  ',
      priority: 'low',
    });
    const attached = await db
      .select()
      .from(schema.taskLabel)
      .where(eq(schema.taskLabel.taskId, created.firstTask.id));
    expect(attached.map((l) => l.labelId)).toEqual([labelId]);
  });

  it('resolves a template by name and supplies its priority when omitted', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await seedTemplate(seed);
    const client = await connectCatalog(registerTools, seed.ctx);
    const result = await client.callTool({
      name: 'repeat_task',
      arguments: {
        orgId: seed.orgId,
        template: 'weekly review',
        recurringTask: {
          task: { teamId: seed.teamId, title: 'Review' },
          schedule: { kind: 'after_completion', interval: 1, unit: 'week' },
        },
      },
    });
    expect(result.isError).not.toBe(true);
    const created = body<{ firstTask: { id: string } }>(result);
    const [row] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, created.firstTask.id));
    expect(row).toMatchObject({ description: '## Review', priority: 'high' });
  });

  it('preserves explicit empty labels, drops deleted default labels, and leaves text alone for an empty template body', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const labelId = await seedLabel(db, schema, seed, { name: 'Review' });
    const deleted = await seedLabel(db, schema, seed, { name: 'Deleted' });
    await db.delete(schema.label).where(eq(schema.label.id, deleted));
    const id = await seedTemplate(seed, {
      payload: {
        targetType: 'task',
        description: '',
        labelIds: [LabelId.parse(labelId), LabelId.parse(deleted)],
      },
    });
    const client = await connectCatalog(registerTools, seed.ctx);
    for (const labels of [undefined, []]) {
      const result = await client.callTool({
        name: 'repeat_task',
        arguments: {
          orgId: seed.orgId,
          template: id,
          recurringTask: {
            task: {
              teamId: seed.teamId,
              title: 'Review',
              description: 'Authored.  ',
              ...(labels === undefined ? {} : { labels }),
            },
            schedule: { kind: 'after_completion', interval: 1, unit: 'week' },
          },
        },
      });
      expect(result.isError).not.toBe(true);
      const created = body<{ firstTask: { id: string } }>(result);
      const [row] = await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.id, created.firstTask.id));
      expect(row?.description).toBe('Authored.  ');
      const attached = await db
        .select()
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.taskId, created.firstTask.id));
      expect(attached.map((l) => l.labelId)).toEqual(labels === undefined ? [labelId] : []);
    }
  });

  it('refuses hidden, wrong-kind, and wrong-team templates before creating recurring work', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await joinTeam(db, schema, seed, seed.teamId);
    const otherTeam = await seedSecondTeam(db, schema, seed);
    const hidden = await seedTemplate(seed, { ownerActorId: seed.sarahId });
    const wrongKind = await seedTemplate(seed, {
      targetType: 'project',
      payload: { targetType: 'project' },
    });
    const wrongTeam = await seedTemplate(seed, { scope: 'team', teamId: seed.teamId });
    const client = await connectCatalog(registerTools, seed.ctx);
    for (const template of [hidden, wrongKind, wrongTeam]) {
      const result = await client.callTool({
        name: 'repeat_task',
        arguments: {
          orgId: seed.orgId,
          template,
          recurringTask: {
            task: { teamId: otherTeam, title: 'Refused review' },
            schedule: { kind: 'after_completion', interval: 1, unit: 'week' },
          },
        },
      });
      expect(result.isError).toBe(true);
    }
    const rows = await db
      .select()
      .from(schema.processDefinition)
      .where(eq(schema.processDefinition.organizationId, seed.orgId));
    expect(rows).toEqual([]);
  });
});
