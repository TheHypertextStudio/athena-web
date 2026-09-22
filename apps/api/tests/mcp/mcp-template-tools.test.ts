/** `define_template`: creating and editing templates over MCP, and undoing it. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  errorText,
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

interface TemplateResult {
  changed: number;
  changes: {
    id: string;
    title: string;
    note: string;
    matched: boolean;
    fields: { field: string; from: string; to: string }[];
  }[];
  changeSetId: string | null;
}

/** Load one template row. */
async function templateRow(id: string) {
  const [row] = await db.select().from(schema.template).where(eq(schema.template.id, id));
  return row;
}

describe('define_template', () => {
  it('creates a personal task template whose labels are given by name', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const bugId = await seedLabel(db, schema, seed, { name: 'Bug' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: {
          orgId: seed.orgId,
          name: 'Bug report',
          payload: { targetType: 'task', title: 'Bug: ', priority: 'high' },
          labels: ['bug'],
        },
      }),
    );
    expect(result.changed).toBe(1);
    expect(result.changes[0]).toMatchObject({
      title: 'Bug report',
      note: 'New · Task template · Only you',
    });
    const row = await templateRow(String(result.changes[0]?.id));
    expect(row).toMatchObject({
      scope: 'personal',
      ownerActorId: seed.actorId,
      targetType: 'task',
    });
    expect(row?.payload).toEqual({
      targetType: 'task',
      title: 'Bug: ',
      priority: 'high',
      labelIds: [bugId],
    });
  });

  it('creates a team template for a team the caller is in, and refuses one it is not in', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await joinTeam(db, schema, seed, seed.teamId);
    await seedSecondTeam(db, schema, seed);
    const client = await connectCatalog(registerTools, seed.ctx);
    const args = (team: string) => ({
      orgId: seed.orgId,
      name: 'Launch plan',
      scope: 'team',
      team,
      payload: { targetType: 'project', summary: 'Ship it' },
    });

    const ok = body<TemplateResult>(
      await client.callTool({ name: 'define_template', arguments: args('Core') }),
    );
    expect(ok.changes[0]?.note).toBe('New · Project template · Core');

    const refused = await client.callTool({ name: 'define_template', arguments: args('Design') });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('not_found');
  });

  it('refuses a label limited to a team the template is not for', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const designId = await seedSecondTeam(db, schema, seed);
    await seedLabel(db, schema, seed, { name: 'Figma', teamId: designId });
    const client = await connectCatalog(registerTools, seed.ctx);

    const refused = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        name: 'Design task',
        payload: { targetType: 'task' },
        labels: ['Figma'],
      },
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('not_found');
  });

  it('refuses labels on a template that does not create tasks', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await seedLabel(db, schema, seed, { name: 'Bug' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const refused = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        name: 'Roadmap',
        payload: { targetType: 'initiative' },
        labels: ['Bug'],
      },
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('labels');
  });

  it('edits a template by name, reporting what moved, and undo restores it', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await seedLabel(db, schema, seed, { name: 'Bug' });
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: {
          orgId: seed.orgId,
          name: 'Bug report',
          scope: 'organization',
          payload: { targetType: 'task', priority: 'low' },
        },
      }),
    );
    const id = String(created.changes[0]?.id);

    const edited = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: {
          orgId: seed.orgId,
          template: 'bug report',
          description: 'For anything broken',
          payload: { targetType: 'task', priority: 'urgent', description: '## Steps' },
          labels: ['Bug'],
        },
      }),
    );
    expect(edited.changes[0]?.fields).toEqual([
      { field: 'description', from: 'none', to: 'For anything broken' },
      { field: 'body', from: 'none', to: '## Steps' },
      { field: 'labels', from: 'none', to: 'Bug' },
      { field: 'priority', from: 'low', to: 'urgent' },
    ]);

    const undone = body<{ reverted: number }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: edited.changeSetId },
      }),
    );
    expect(undone.reverted).toBe(1);
    const row = await templateRow(id);
    expect(row?.description).toBeNull();
    expect(row?.payload).toEqual({ targetType: 'task', priority: 'low' });
  });

  it('refuses to change the kind of work a template creates', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: { orgId: seed.orgId, name: 'Kickoff', payload: { targetType: 'project' } },
      }),
    );

    const refused = await client.callTool({
      name: 'define_template',
      arguments: {
        orgId: seed.orgId,
        template: String(created.changes[0]?.id),
        payload: { targetType: 'task' },
      },
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('payload.targetType');
  });

  it('undoes a created template by deleting it', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: { orgId: seed.orgId, name: 'Retro', payload: { targetType: 'initiative' } },
      }),
    );

    await client.callTool({
      name: 'undo',
      arguments: { orgId: seed.orgId, changeSetId: created.changeSetId },
    });
    expect(await templateRow(String(created.changes[0]?.id))).toBeUndefined();
  });

  it('changes only a task template’s labels, keeping the rest of its draft', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const bugId = await seedLabel(db, schema, seed, { name: 'Bug' });
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: {
          orgId: seed.orgId,
          name: 'Triage',
          payload: { targetType: 'task', priority: 'high' },
        },
      }),
    );
    const id = String(created.changes[0]?.id);

    const edited = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: { orgId: seed.orgId, template: id, labels: ['Bug'] },
      }),
    );
    expect(edited.changes[0]?.fields).toEqual([{ field: 'labels', from: 'none', to: 'Bug' }]);
    expect((await templateRow(id))?.payload).toEqual({
      targetType: 'task',
      priority: 'high',
      labelIds: [bugId],
    });
  });

  it('refuses an edit that names nothing to change', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: { orgId: seed.orgId, name: 'Retro', payload: { targetType: 'program' } },
      }),
    );

    const refused = await client.callTool({
      name: 'define_template',
      arguments: { orgId: seed.orgId, template: String(created.changes[0]?.id) },
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('template');
  });

  it('moves a template to the caller alone, then to a team, taking the team’s labels', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await joinTeam(db, schema, seed, seed.teamId);
    await seedLabel(db, schema, seed, { name: 'Core only', teamId: seed.teamId });
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: {
          orgId: seed.orgId,
          name: 'Standup',
          scope: 'organization',
          payload: { targetType: 'task' },
        },
      }),
    );
    const id = String(created.changes[0]?.id);

    const personal = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: { orgId: seed.orgId, template: id, scope: 'personal' },
      }),
    );
    expect(personal.changes[0]?.note).toBe('Task template · Only you');
    expect(personal.changes[0]?.fields).toEqual([
      { field: 'scope', from: 'organization', to: 'personal' },
    ]);

    const team = body<TemplateResult>(
      await client.callTool({
        name: 'define_template',
        arguments: {
          orgId: seed.orgId,
          template: id,
          scope: 'team',
          team: 'Core',
          labels: ['Core only'],
        },
      }),
    );
    expect(team.changes[0]?.note).toBe('Task template · Core');
    expect((await templateRow(id))?.teamId).toBe(seed.teamId);
  });

  it('asks for a name and a payload before creating anything', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, seed.ctx);

    const refused = await client.callTool({
      name: 'define_template',
      arguments: { orgId: seed.orgId, name: 'Half a template' },
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain('payload');
  });
});
