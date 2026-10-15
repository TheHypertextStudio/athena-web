import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { WorkTypeId } from '@docket/work/ids';
import { TeamId } from '@docket/identity-access/ids';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../support/routes-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';
import { loadCreationActor } from '../../src/lib/work-creation/context';
import { createWork } from '../../src/lib/work-creation/service';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { appProvenance, originFor } from '../../src/lib/provenance/context';

let schema: typeof DbModule;
const harnesses: { client: Client; server: McpServer }[] = [];
beforeAll(async () => {
  schema = await getDb();
});
afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.server.close();
  }
});
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['manage']);
  const caller = await loadCreationActor(schema.db, f.orgId, f.actorId);
  const draft = await createWorkTemplate(caller, {
    targetType: 'project',
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Event',
      payload: { targetType: 'project' },
      blueprint: {
        steps: [
          {
            key: 'prepare',
            kind: 'task',
            parentStepKey: null,
            sort: 0,
            fields: { title: 'Prepare dinner' },
            template: null,
            optional: { enabled: false, selectedByDefault: true },
            teamRule: 'parent_team',
            actorRule: 'creator',
            cycleRule: 'none',
            dates: {
              dueDate: {
                kind: 'anchor',
                anchor: { kind: 'parent' },
                offset: { days: -2, unit: 'calendar' },
              },
            },
          },
        ],
        dependencies: [],
      },
    }),
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const work = await createWork({
    caller,
    kind: 'project',
    body: {
      name: 'Dinner',
      teamId: TeamId.parse(f.teamId),
      targetDate: '2026-10-20',
      workTypeId: WorkTypeId.parse(published.id),
    },
    invocation: { origin: originFor('project_create', {}, appProvenance()) },
  });
  const child = work.created.find((row) => row.kind === 'task');
  if (!child) throw new Error('Missing generated Task');
  const { registerTools } = await import('../../src/mcp/tools');
  const server = new McpServer({ name: 'blueprint-update', version: '1' });
  registerTools(server, f.ctx, 'blueprint-update');
  const client = new Client({ name: 'test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  harnesses.push({ client, server });
  return { ...f, root: work.root, child, client };
}
describe('blueprint dates through MCP update', () => {
  it('moves generated dates and records root plus child in one aggregate receipt', async () => {
    const f = await fixture();
    const result = await f.client.callTool({
      name: 'update',
      arguments: {
        orgId: f.orgId,
        entity: 'project',
        scope: { ids: [f.root.id] },
        set: { targetDate: '2026-10-25' },
      },
    });
    expect(result.isError).toBeFalsy();
    const [saved] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, f.child.id));
    expect(saved?.dueDate?.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const update = receipts.filter((receipt) => receipt.origin.tool === 'update');
    expect(update).toHaveLength(1);
    const entries = await schema.db
      .select()
      .from(schema.changeSetEntry)
      .where(eq(schema.changeSetEntry.changeSetId, assertDefined(update[0]).id));
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityKind: 'project', entityId: f.root.id }),
        expect.objectContaining({ entityKind: 'task', entityId: f.child.id }),
      ]),
    );
  });
  it('pins a same-value date and preserves it after a later anchor move', async () => {
    const f = await fixture();
    expect(
      (
        await f.client.callTool({
          name: 'update',
          arguments: {
            orgId: f.orgId,
            entity: 'task',
            scope: { ids: [f.child.id] },
            set: { dueDate: '2026-10-18' },
          },
        })
      ).isError,
    ).toBeFalsy();
    const [pinned] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, f.child.id));
    expect(pinned?.blueprintDateBindings.dueDate?.manual).toBe(true);
    await f.client.callTool({
      name: 'update',
      arguments: {
        orgId: f.orgId,
        entity: 'project',
        scope: { ids: [f.root.id] },
        set: { targetDate: '2026-10-25' },
      },
    });
    const [saved] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, f.child.id));
    expect(saved?.dueDate?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });
  it('undo restores the initiating anchor and dependent date ownership together', async () => {
    const f = await fixture();
    const changed = await f.client.callTool({
      name: 'update',
      arguments: {
        orgId: f.orgId,
        entity: 'project',
        scope: { ids: [f.root.id] },
        set: { targetDate: '2026-10-25' },
      },
    });
    expect(changed.isError).toBeFalsy();
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const receipt = assertDefined(receipts.find((entry) => entry.origin.tool === 'update'));
    const undone = await f.client.callTool({
      name: 'undo',
      arguments: { orgId: f.orgId, changeSetId: receipt.id },
    });
    expect(undone.isError).toBeFalsy();
    const [root] = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, f.root.id));
    const [child] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, f.child.id));
    expect(root?.targetDate?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(child?.dueDate?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(child?.blueprintDateBindings.dueDate).toMatchObject({
      manual: false,
      lastDerivedDate: '2026-10-18',
    });
  });
  it('rolls back the initiating edit when a dependent date write fails', async () => {
    const f = await fixture();
    await schema.db.execute(
      sql`CREATE FUNCTION reject_mcp_blueprint_date() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN RAISE EXCEPTION 'Reject derived date'; END IF; RETURN NEW; END $$`,
    );
    await schema.db.execute(
      sql`CREATE TRIGGER reject_mcp_blueprint_date BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION reject_mcp_blueprint_date()`,
    );
    try {
      const result = await f.client.callTool({
        name: 'update',
        arguments: {
          orgId: f.orgId,
          entity: 'project',
          scope: { ids: [f.root.id] },
          set: { targetDate: '2026-10-25' },
        },
      });
      expect(result.isError).toBe(true);
      const [saved] = await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.id, f.root.id));
      expect(saved?.targetDate?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    } finally {
      await schema.db.execute(sql`DROP TRIGGER reject_mcp_blueprint_date ON task`);
      await schema.db.execute(sql`DROP FUNCTION reject_mcp_blueprint_date()`);
    }
  });
});
