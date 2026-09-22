/** `define_labels`: creating and editing the label vocabulary over MCP, and undoing it. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  body,
  closeCatalogClients,
  connectCatalog,
  seedLabel,
  seedLabelGroup,
  seedSecondTeam,
} from './mcp-catalog-harness';
import { seedMcpUpdateOrg, seedMcpUpdateTask } from './mcp-update-tool-fixtures';

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

interface Row {
  kind: string;
  id: string;
  title: string;
  note: string;
  matched: boolean;
  fields: { field: string; from: string; to: string }[];
}
interface DefineResult {
  changed: number;
  changes: Row[];
  skipped: { kind: string; title: string; reason: string }[];
  changeSetId: string | null;
}

const MANAGER = ['view', 'contribute', 'manage'] as const;

/** The org's labels by name. */
async function labelsOf(orgId: string) {
  const rows = await db.select().from(schema.label).where(eq(schema.label.organizationId, orgId));
  return new Map(rows.map((row) => [row.name, row]));
}

describe('define_labels', () => {
  it('declares itself an idempotent, non-destructive write with a change-report card', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const client = await connectCatalog(registerTools, seed.ctx);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'define_labels');
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(JSON.stringify(tool?._meta)).toContain('ui://docket/change-report');
  });

  it('creates a group and labels that join it in one call, and a re-run changes nothing', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const client = await connectCatalog(registerTools, seed.ctx);
    const args = {
      orgId: seed.orgId,
      groups: [{ name: 'Severity', team: 'Core' }],
      labels: [
        { name: 'Low', group: 'Severity' },
        { name: 'High', group: 'Severity', color: 'coral' },
      ],
    };

    const first = body<DefineResult>(
      await client.callTool({ name: 'define_labels', arguments: args }),
    );
    expect(first.changed).toBe(3);
    expect(first.skipped).toEqual([]);
    expect(first.changes.map((r) => [r.kind, r.title, r.note])).toEqual([
      ['label_group', 'Severity', 'New · Group · one at a time · Core'],
      ['label', 'Low', 'New · Severity · Core'],
      ['label', 'High', 'New · Severity · Core'],
    ]);
    const labels = await labelsOf(seed.orgId);
    // A label joining a team-limited group takes the group's team.
    expect(labels.get('High')).toMatchObject({ color: 'coral', teamId: seed.teamId });

    const again = body<DefineResult>(
      await client.callTool({ name: 'define_labels', arguments: args }),
    );
    expect(again.changed).toBe(0);
    expect(again.changeSetId).toBeNull();
    expect(again.changes.every((r) => r.matched)).toBe(true);
    expect((await labelsOf(seed.orgId)).size).toBe(2);
  });

  it('renames and recolors an existing label, reporting what moved', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    await seedLabel(db, schema, seed, { name: 'bug', color: 'blue' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, labels: [{ label: 'bug', name: 'Defect', color: 'pink' }] },
      }),
    );
    expect(result.changes[0]?.fields).toEqual([
      { field: 'name', from: 'bug', to: 'Defect' },
      { field: 'color', from: 'blue', to: 'pink' },
    ]);
    expect((await labelsOf(seed.orgId)).get('Defect')?.color).toBe('pink');
  });

  it('matches an existing label by name without regard to case', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    await seedLabel(db, schema, seed, { name: 'Bug', color: 'blue' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, labels: [{ name: 'bug', color: 'amber' }] },
      }),
    );
    // "bug" names the existing "Bug"; the entry recolors it and renames it to the typed case.
    expect(result.changes[0]?.fields.map((f) => f.field)).toEqual(['name', 'color']);
    expect((await labelsOf(seed.orgId)).size).toBe(1);
  });

  it('skips a rename onto a taken name while the rest of the call still applies', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    await seedLabel(db, schema, seed, { name: 'Bug' });
    await seedLabel(db, schema, seed, { name: 'Feature' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: {
          orgId: seed.orgId,
          labels: [{ label: 'Feature', name: 'bug' }, { name: 'Chore' }],
        },
      }),
    );
    expect(result.skipped).toEqual([
      expect.objectContaining({ kind: 'label', title: 'bug', reason: 'conflict' }),
    ]);
    expect(result.changes.map((r) => r.title)).toEqual(['Chore']);
  });

  it('refuses a team from another workspace', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const other = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, groups: [{ name: 'Area', team: other.teamId }] },
      }),
    );
    expect(result.skipped[0]?.reason).toBe('not_found');
    expect(result.changed).toBe(0);
  });

  it('lets a contributor create labels but not restyle them, and never refuses a no-op', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    await seedLabel(db, schema, seed, { name: 'Bug', color: 'blue' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: {
          orgId: seed.orgId,
          labels: [
            { name: 'Bug', color: 'blue' },
            { name: 'Bug', color: 'teal' },
            { name: 'Docs' },
          ],
        },
      }),
    );
    expect(result.changes.map((r) => [r.title, r.matched])).toEqual([
      ['Bug', true],
      ['Docs', false],
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ title: 'Bug', reason: 'not_permitted' }),
    ]);
  });

  it('moves a group’s labels with it when its team changes, and undo moves them back', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const designId = await seedSecondTeam(db, schema, seed);
    const groupId = await seedLabelGroup(db, schema, seed, { name: 'Stage', teamId: seed.teamId });
    const memberId = await seedLabel(db, schema, seed, {
      name: 'Draft',
      groupId,
      teamId: seed.teamId,
    });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: {
          orgId: seed.orgId,
          groups: [{ group: 'Stage', name: 'Stage', team: 'Design' }],
        },
      }),
    );
    expect(result.changes[0]?.fields).toEqual([{ field: 'teamId', from: 'Core', to: 'Design' }]);
    const moved = await db.select().from(schema.label).where(eq(schema.label.id, memberId));
    expect(moved[0]?.teamId).toBe(designId);

    const undone = body<{ reverted: number }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: result.changeSetId },
      }),
    );
    expect(undone.reverted).toBe(1);
    const back = await db.select().from(schema.label).where(eq(schema.label.id, memberId));
    expect(back[0]?.teamId).toBe(seed.teamId);
  });

  it('undoes a created label, but leaves one that has since been put on work', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, labels: [{ name: 'Spike' }, { name: 'Urgent' }] },
      }),
    );
    const urgent = created.changes.find((r) => r.title === 'Urgent');
    const taskId = await seedMcpUpdateTask(db, schema, seed);
    await db
      .insert(schema.taskLabel)
      .values({ organizationId: seed.orgId, taskId, labelId: String(urgent?.id) });

    const undone = body<{ reverted: number; skipped: { id: string; reason: string }[] }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: created.changeSetId },
      }),
    );
    expect(undone.reverted).toBe(1);
    expect(undone.skipped).toEqual([{ kind: 'label', id: urgent?.id, reason: 'in_use' }]);
    const left = await labelsOf(seed.orgId);
    expect([...left.keys()]).toEqual(['Urgent']);
  });

  it('refuses a call that defines nothing', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const client = await connectCatalog(registerTools, seed.ctx);

    const refused = await client.callTool({
      name: 'define_labels',
      arguments: { orgId: seed.orgId },
    });
    expect(refused.isError).toBe(true);
  });

  it('lets a group allow any combination, saying so in words', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    await seedLabelGroup(db, schema, seed, { name: 'Area' });
    const client = await connectCatalog(registerTools, seed.ctx);

    const result = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, groups: [{ name: 'Area', exclusive: false }] },
      }),
    );
    expect(result.changes[0]).toMatchObject({
      note: 'Group · any combination · Workspace',
      fields: [{ field: 'exclusive', from: 'one at a time', to: 'any combination' }],
    });
  });

  it('reports a created label someone has since deleted as gone', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const client = await connectCatalog(registerTools, seed.ctx);
    const created = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, labels: [{ name: 'Temp' }] },
      }),
    );
    const id = String(created.changes[0]?.id);
    await db.delete(schema.label).where(eq(schema.label.id, id));

    const undone = body<{ skipped: unknown[] }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: created.changeSetId },
      }),
    );
    expect(undone.skipped).toEqual([{ kind: 'label', id, reason: 'gone' }]);
  });

  it('will not undo an edit someone has changed since', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, [...MANAGER]);
    const labelId = await seedLabel(db, schema, seed, { name: 'Bug', color: 'blue' });
    const client = await connectCatalog(registerTools, seed.ctx);
    const edited = body<DefineResult>(
      await client.callTool({
        name: 'define_labels',
        arguments: { orgId: seed.orgId, labels: [{ name: 'Bug', color: 'green' }] },
      }),
    );
    await db
      .update(schema.label)
      .set({ color: 'violet' })
      .where(and(eq(schema.label.id, labelId), eq(schema.label.organizationId, seed.orgId)));

    const undone = body<{ skipped: { reason: string }[] }>(
      await client.callTool({
        name: 'undo',
        arguments: { orgId: seed.orgId, changeSetId: edited.changeSetId },
      }),
    );
    expect(undone.skipped).toEqual([{ kind: 'label', id: labelId, reason: 'changed_since' }]);
    expect((await labelsOf(seed.orgId)).get('Bug')?.color).toBe('violet');
  });
});
