import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { body, closeCatalogClients, connectCatalog } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema: typeof DbModule, registerTools: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

describe('manual work starter MCP adapters', () => {
  it('discovers the complete intended fork rather than the first browse page', async () => {
    const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, f.ctx);
    const result = await client.callTool({
      name: 'browse_work_templates',
      arguments: { orgId: f.orgId, query: { action: 'fork', fork: 'startup' } },
    });
    expect(result.isError).not.toBe(true);
    const output = body<{ data: { fork: string; items: unknown[] } }>(result);
    expect(output.data.fork).toBe('startup');
    expect(output.data.items).toHaveLength(60);
  });
  it('previews, keeps a private canonical Event and reconciles the same receipt', async () => {
    const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, f.ctx);
    const choices = {
      roots: [{ kind: 'catalog', slug: 'event', release: 1 }],
      mode: 'private_drafts',
    };
    const preview = await client.callTool({
      name: 'copy_work_templates',
      arguments: { orgId: f.orgId, query: { action: 'preview', ...choices } },
    });
    expect(preview.isError).not.toBe(true);
    const review = body<{ data: { reviewFingerprint: string; copies: unknown[] } }>(preview).data;
    expect(review.copies).toHaveLength(2);
    const requestId = crypto.randomUUID();
    const kept = await client.callTool({
      name: 'copy_work_templates',
      arguments: {
        orgId: f.orgId,
        query: {
          action: 'keep',
          ...choices,
          requestId,
          expectedReviewFingerprint: review.reviewFingerprint,
        },
      },
    });
    expect(kept.isError).not.toBe(true);
    const receipt = body<{
      data: { mode: string; state: string; roots: { workTypeVersionId: string | null }[] };
    }>(kept).data;
    expect(receipt).toMatchObject({ mode: 'private_drafts', state: 'installed' });
    expect(receipt.roots.every((root) => root.workTypeVersionId === null)).toBe(true);
    const retry = await client.callTool({
      name: 'copy_work_templates',
      arguments: { orgId: f.orgId, query: { action: 'reconcile', requestId } },
    });
    expect(retry.isError).not.toBe(true);
    expect(body<{ data: unknown }>(retry).data).toEqual(receipt);
  });
  it('allows read-only preview and reconciliation but requires write scope to keep', async () => {
    const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    const client = await connectCatalog(registerTools, { ...f.ctx, scopes: ['work:read'] });
    const choices = {
      roots: [{ kind: 'catalog', slug: 'event', release: 1 }],
      mode: 'private_drafts',
    };
    const preview = await client.callTool({
      name: 'copy_work_templates',
      arguments: { orgId: f.orgId, query: { action: 'preview', ...choices } },
    });
    expect(preview.isError).not.toBe(true);
    const review = body<{ data: { reviewFingerprint: string } }>(preview).data;
    const denied = await client.callTool({
      name: 'copy_work_templates',
      arguments: {
        orgId: f.orgId,
        query: {
          action: 'keep',
          ...choices,
          requestId: crypto.randomUUID(),
          expectedReviewFingerprint: review.reviewFingerprint,
        },
      },
    });
    expect(denied.isError).toBe(true);
    const writer = await connectCatalog(registerTools, f.ctx);
    const requestId = crypto.randomUUID();
    const kept = await writer.callTool({
      name: 'copy_work_templates',
      arguments: {
        orgId: f.orgId,
        query: {
          action: 'keep',
          ...choices,
          requestId,
          expectedReviewFingerprint: review.reviewFingerprint,
        },
      },
    });
    expect(kept.isError).not.toBe(true);
    const reconciled = await client.callTool({
      name: 'copy_work_templates',
      arguments: { orgId: f.orgId, query: { action: 'reconcile', requestId } },
    });
    expect(reconciled.isError).not.toBe(true);
    expect(body<{ data: unknown }>(reconciled).data).toEqual(body<{ data: unknown }>(kept).data);
  });
  it('cannot bypass human review by asking the real Athena toolbox to keep a valid copy review', async () => {
    const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
    if (f.ctx.principal.kind !== 'user') throw new Error('Missing human fixture');
    const client = await connectCatalog(registerTools, f.ctx);
    const choices = { roots: [{ kind: 'catalog', slug: 'event', release: 1 }], mode: 'published' };
    const preview = await client.callTool({
      name: 'copy_work_templates',
      arguments: { orgId: f.orgId, query: { action: 'preview', ...choices } },
    });
    expect(preview.isError).not.toBe(true);
    const review = body<{ data: { reviewFingerprint: string } }>(preview).data;
    const definitionsBefore = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, f.orgId));
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: f.ctx.principal.userId,
        contextOrganizationId: f.orgId,
        trigger: 'delegation',
        status: 'running',
      })
      .returning();
    if (!session) throw new Error('Missing session fixture');
    const { openToolbox } = await import('../../src/agent/toolbox');
    const toolbox = await openToolbox(
      { kind: 'athena', ownerUserId: f.ctx.principal.userId },
      session.id,
    );
    try {
      const result = await toolbox.callTool('copy_work_templates', {
        orgId: f.orgId,
        query: {
          action: 'keep',
          ...choices,
          requestId: crypto.randomUUID(),
          expectedReviewFingerprint: review.reviewFingerprint,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('forbidden:');
      const bundles = await schema.db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.organizationId, f.orgId));
      const definitions = await schema.db
        .select()
        .from(schema.template)
        .where(eq(schema.template.organizationId, f.orgId));
      expect(bundles).toEqual([]);
      expect(definitions).toEqual(definitionsBefore);
    } finally {
      await toolbox.close();
    }
  });
});
