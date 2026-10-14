/** Existing work remains governed by its current resource grants inside a personal plan. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { LinkHarness, seedLinkOrg, type LinkDb, type LinkSeed } from './mcp-link-fixtures';

let handle: LinkDb;
let harness: LinkHarness;

beforeAll(async () => {
  const schema = await getMigratedDb();
  handle = { schema, db: schema.db };
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});

afterEach(async () => {
  await harness.closeAll();
  resetAuthMocks();
});

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function content(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).toBeFalsy();
  return result.structuredContent ?? {};
}

/** Allow workspace creation and root contribution, but only viewing the private project. */
async function viewerPlan() {
  const s = await seedLinkOrg(handle);
  const { db, schema } = handle;
  await db
    .update(schema.grant)
    .set({ cascades: false })
    .where(eq(schema.grant.organizationId, s.orgId));
  await db
    .update(schema.project)
    .set({ visibility: 'private' })
    .where(eq(schema.project.id, s.projectId));
  await db.insert(schema.grant).values({
    organizationId: s.orgId,
    subjectKind: 'actor',
    subjectId: s.actorId,
    resourceKind: 'initiative',
    resourceId: s.initiativeId,
    capabilities: ['contribute'],
    effect: 'allow',
  });
  const [grant] = await db
    .insert(schema.grant)
    .values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: s.actorId,
      resourceKind: 'project',
      resourceId: s.projectId,
      capabilities: ['view'],
      effect: 'allow',
    })
    .returning();
  await db.insert(schema.initiativeProject).values({
    organizationId: s.orgId,
    initiativeId: s.initiativeId,
    projectId: s.projectId,
  });
  const client = await harness.connect(s.ctx);
  const plan = content(
    await call(client, 'plan_start', { orgId: s.orgId, initiative: s.initiativeId }),
  );
  const { loadOwnedPlan } = await import('../../src/lib/plan-draft/store');
  const row = await loadOwnedPlan(s.userId, String(plan['planId']));
  const projectRef = assertDefined(
    row.document.nodes.find((node) => node.objectId === s.projectId),
  ).ref;
  return { s, client, row, projectRef, grantId: assertDefined(grant).id };
}

/** Confirm one newly drafted child, returning the tool's refusal or receipt. */
async function confirm(
  client: Client,
  s: LinkSeed,
  plan: { id: string; revision: number },
  ops: unknown[],
  ref: string,
) {
  content(await call(client, 'plan_draft', { planId: plan.id, revision: plan.revision, ops }));
  return call(client, 'plan_commit', {
    orgId: s.orgId,
    planId: plan.id,
    refs: [ref],
    withoutTemplateReason: 'Explicit freeform work for resource authorization acceptance.',
  });
}

describe('existing work in personal plans', () => {
  it('refuses placing a child under a view-only project without creating partial work', async () => {
    const { s, client, row, projectRef } = await viewerPlan();
    const result = await confirm(
      client,
      s,
      row,
      [
        {
          op: 'upsert_node',
          node: {
            ref: 'child',
            kind: 'task',
            parentRef: projectRef,
            fields: { title: 'Unauthorized child' },
          },
        },
      ],
      'child',
    );
    expect(result.isError).toBe(true);
    const { db, schema } = handle;
    expect(
      await db
        .select()
        .from(schema.task)
        .where(
          and(eq(schema.task.organizationId, s.orgId), eq(schema.task.title, 'Unauthorized child')),
        ),
    ).toHaveLength(0);
  });

  it('refuses dependencies against view-only imported projects and rolls back the new project', async () => {
    const { s, client, row, projectRef } = await viewerPlan();
    const result = await confirm(
      client,
      s,
      row,
      [
        {
          op: 'upsert_node',
          node: {
            ref: 'next',
            kind: 'project',
            parentRef: 'root',
            fields: { title: 'Unauthorized dependency' },
          },
        },
        { op: 'add_edge', fromRef: projectRef, toRef: 'next' },
      ],
      'next',
    );
    expect(result.isError).toBe(true);
    const { db, schema } = handle;
    expect(
      await db
        .select()
        .from(schema.project)
        .where(
          and(
            eq(schema.project.organizationId, s.orgId),
            eq(schema.project.name, 'Unauthorized dependency'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('redacts revoked confirmed work on reads and reopen without discarding authored drafts', async () => {
    const { s, client, row, projectRef, grantId } = await viewerPlan();
    content(
      await call(client, 'plan_draft', {
        planId: row.id,
        revision: row.revision,
        ops: [
          {
            op: 'upsert_node',
            node: {
              ref: 'draft',
              kind: 'task',
              parentRef: projectRef,
              fields: { title: 'Keep my draft' },
            },
          },
        ],
      }),
    );
    const { db, schema } = handle;
    await db.delete(schema.grant).where(eq(schema.grant.id, grantId));
    await db
      .update(schema.project)
      .set({ name: 'Secret after revocation', health: 'at_risk' })
      .where(eq(schema.project.id, s.projectId));
    const read = content(await call(client, 'plan_read', { planId: row.id }));
    const reopened = content(
      await call(client, 'plan_start', { orgId: s.orgId, initiative: s.initiativeId }),
    );
    const { loadOwnedPlan, presentPlan } = await import('../../src/lib/plan-draft/store');
    const presented = await presentPlan(await loadOwnedPlan(s.userId, row.id));
    for (const result of [read, reopened, presented]) {
      expect(JSON.stringify(result)).not.toContain('Secret after revocation');
      expect(JSON.stringify(result)).not.toContain('Auth Rewrite');
      expect(JSON.stringify(result)).toContain('Keep my draft');
      expect(JSON.stringify(result)).toContain('Unavailable work');
    }
    expect(presented.objects[projectRef]).toBeUndefined();
    const stored = await loadOwnedPlan(s.userId, row.id);
    expect(stored.document.nodes.find((node) => node.ref === 'draft')?.fields.title).toBe(
      'Keep my draft',
    );
  });
});
