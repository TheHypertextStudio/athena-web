/** The initiative links `organize` and `plan_commit` add are recorded, so undo takes them back. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  LinkHarness,
  payload,
  resultText,
  seedLinkOrg,
  type LinkDb,
  type LinkSeed,
} from './mcp-link-fixtures';

let handle!: LinkDb;
let harness!: LinkHarness;

beforeAll(async () => {
  const schema = await getMigratedDb();
  handle = { schema, db: schema.db };
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});

afterEach(async () => {
  await harness.closeAll();
  resetAuthMocks();
});

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(result.isError ?? false, resultText(result)).toBe(false);
  return payload(result);
}

/** The projects linked to the seeded initiative. */
async function projectLinks(s: LinkSeed): Promise<string[]> {
  const rows = await handle.db
    .select({ id: handle.schema.initiativeProject.projectId })
    .from(handle.schema.initiativeProject)
    .where(eq(handle.schema.initiativeProject.initiativeId, s.initiativeId));
  return rows.map((row) => row.id);
}

/** The programs linked to the seeded initiative. */
async function programLinks(s: LinkSeed): Promise<string[]> {
  const rows = await handle.db
    .select({ id: handle.schema.initiativeProgram.programId })
    .from(handle.schema.initiativeProgram)
    .where(eq(handle.schema.initiativeProgram.initiativeId, s.initiativeId));
  return rows.map((row) => row.id);
}

describe('organize initiative links', () => {
  it('records the link it adds to a matched project, and undo removes only the link', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);

    const out = await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Auth Rewrite', initiative: 'Q3 Platform' }],
    });
    expect(out).toMatchObject({ created: 0, matched: 1 });
    expect(out['changeSetId']).not.toBeNull();
    expect(await projectLinks(s)).toEqual([s.projectId]);

    await call(client, 'undo', { orgId: s.orgId, changeSetId: out['changeSetId'] });

    expect(await projectLinks(s)).toEqual([]);
    const [project] = await handle.db
      .select({ archivedAt: handle.schema.project.archivedAt })
      .from(handle.schema.project)
      .where(eq(handle.schema.project.id, s.projectId));
    expect(project?.archivedAt).toBeNull();
  });

  it('records the link it adds to a matched program', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);

    const out = await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'g', kind: 'program', title: 'Reliability', initiative: s.initiativeId }],
    });
    expect(await programLinks(s)).toEqual([s.programId]);

    await call(client, 'undo', { orgId: s.orgId, changeSetId: out['changeSetId'] });

    expect(await programLinks(s)).toEqual([]);
  });

  it('records nothing when the link already existed', async () => {
    const s = await seedLinkOrg(handle);
    await handle.db.insert(handle.schema.initiativeProject).values({
      organizationId: s.orgId,
      initiativeId: s.initiativeId,
      projectId: s.projectId,
    });
    const client = await harness.connect(s.ctx);

    const out = await call(client, 'organize', {
      orgId: s.orgId,
      items: [{ ref: 'p', kind: 'project', title: 'Auth Rewrite', initiative: 'Q3 Platform' }],
    });

    expect(out['changeSetId']).toBeNull();
  });
});

describe('plan_commit initiative links', () => {
  it('records the link a project gets from its root initiative, and undo removes it', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);
    const plan = await call(client, 'plan_start', { orgId: s.orgId, initiative: s.initiativeId });
    await call(client, 'plan_draft', {
      planId: plan['planId'],
      revision: plan['revision'],
      ops: [
        {
          op: 'upsert_node',
          node: { ref: 'p', kind: 'project', parentRef: 'root', fields: { title: 'Launch' } },
        },
      ],
    });
    const committed = await call(client, 'plan_commit', {
      planId: plan['planId'],
      refs: ['p'],
      withoutTemplateReason: 'This test confirms explicitly authored freeform work.',
    });
    expect(await projectLinks(s)).toHaveLength(1);

    await call(client, 'undo', { orgId: s.orgId, changeSetId: committed['changeSetId'] });

    expect(await projectLinks(s)).toEqual([]);
  });
});
