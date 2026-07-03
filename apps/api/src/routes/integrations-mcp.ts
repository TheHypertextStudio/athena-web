/** `@docket/api` — remote-MCP integrations router (`/v1/orgs/:orgId/integrations/mcp`). */
import { db, integration, integrationCredential } from '@docket/db';
import { McpIntegrationCreate, McpIntegrationOut } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { sealCredential, unsealCredential } from '../lib/credentials';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

/** The db row shape this router serializes. */
type IntegrationRow = typeof integration.$inferSelect;

/** The `config` shape an `provider='mcp'` integration row carries. */
interface McpConfig {
  readonly url: string;
  readonly label: string;
  readonly alias: string;
  readonly toolCount?: number;
}

/** Read the MCP config off a row (rows this router creates always carry it). */
function mcpConfig(row: IntegrationRow): McpConfig {
  return row.config as unknown as McpConfig;
}

/** Serialize one MCP integration row (never the credential). */
function toMcpOut(row: IntegrationRow): z.input<typeof McpIntegrationOut> {
  const config = mcpConfig(row);
  return {
    id: row.id,
    organizationId: row.organizationId,
    url: config.url,
    label: config.label,
    alias: config.alias,
    status: row.status,
    toolCount: typeof config.toolCount === 'number' ? config.toolCount : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load an org-scoped `provider='mcp'` integration row, or 404. */
async function loadMcpIntegration(orgId: string, id: string): Promise<IntegrationRow> {
  const rows = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, id),
        eq(integration.organizationId, orgId),
        eq(integration.provider, 'mcp'),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Integration not found');
  return rows[0];
}

/**
 * Health-check one MCP integration: open it with the org's stored credential and
 * `tools/list`. Promotes to `connected` (stamping `toolCount`) or demotes to `error`
 * with the reason — connection state is only ever earned by a real round trip.
 */
async function verifyIntegration(row: IntegrationRow): Promise<IntegrationRow> {
  const config = mcpConfig(row);
  const credRows = await db
    .select({ ciphertext: integrationCredential.ciphertext })
    .from(integrationCredential)
    .where(eq(integrationCredential.integrationId, row.id))
    .limit(1);
  const bearerToken = credRows[0] ? unsealCredential(credRows[0].ciphertext) : undefined;

  let patch: Partial<typeof integration.$inferInsert>;
  try {
    const session = await getContainer().mcpConnector.open({
      url: config.url,
      ...(bearerToken ? { bearerToken } : {}),
    });
    try {
      const tools = await session.listTools();
      patch = {
        status: 'connected',
        lastError: null,
        lastErrorAt: null,
        config: { ...config, toolCount: tools.length },
      };
    } finally {
      await session.close();
    }
  } catch (cause) {
    patch = {
      status: 'error',
      lastError: cause instanceof Error ? cause.message : 'Connection failed',
      lastErrorAt: new Date(),
    };
  }

  const [updated] = await db
    .update(integration)
    .set(patch)
    .where(eq(integration.id, row.id))
    .returning();
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!updated) throw new Error('integration update returned no row');
  return updated;
}

const idParam = z.object({ id: z.string() });

const router = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Integrations',
      summary: 'List remote MCP servers',
      response: z.array(McpIntegrationOut),
      description: `List the org's connected remote MCP servers as {@link McpIntegrationOut} (URL, label, alias, connection health, advertised tool count — never the credential). These are the org-held connections Athena's toolbox unions in as \`<alias>__<name>\` tools. A read; org membership suffices.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(integration)
        .where(and(eq(integration.organizationId, orgId), eq(integration.provider, 'mcp')))
        .orderBy(asc(integration.createdAt));
      return ok(c, z.array(McpIntegrationOut), rows.map(toMcpOut));
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Connect a remote MCP server',
      capability: 'manage',
      response: McpIntegrationOut,
      description: `Connect a remote MCP server (Streamable HTTP) the org's agents may use. The optional \`bearerToken\` is the ORG'S credential — sealed AES-256-GCM at rest (\`CREDENTIALS_ENCRYPTION_KEY\` required to store one), never returned, and never a caller's token (the no-passthrough MUST: agents reach remote services only with org-held credentials). Connecting performs a live \`tools/list\` health check; the returned {@link McpIntegrationOut} carries \`connected\` + \`toolCount\` on success or \`error\` + \`lastError\` on failure — a connection is never reported healthy without a real round trip. \`alias\` (unique per org) becomes the tool namespace: Athena sees this server's tools as \`<alias>__<name>\`. Requires \`manage\` — linking an external system is an org-configuration act.`,
    }),
    zJson(McpIntegrationCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      const existing = await db
        .select({ id: integration.id, config: integration.config })
        .from(integration)
        .where(and(eq(integration.organizationId, orgId), eq(integration.provider, 'mcp')));
      if (existing.some((row) => (row.config as unknown as McpConfig).alias === body.alias)) {
        throw new ConflictError(`Alias "${body.alias}" is already in use in this organization`);
      }

      // Seal BEFORE the insert so a missing key aborts cleanly with nothing stored.
      const ciphertext = body.bearerToken ? sealCredential(body.bearerToken) : null;

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(integration)
          .values({
            organizationId: orgId,
            provider: 'mcp',
            pattern: 'connector',
            roles: ['work'],
            status: 'pending',
            config: { url: body.url, label: body.label, alias: body.alias },
            ...(ciphertext ? { connection: { credentialsRef: 'integration_credential' } } : {}),
            syncCadenceMinutes: null,
            createdBy: actorId,
          })
          .returning();
        /* v8 ignore next -- @preserve defensive: insert always returns a row */
        if (!row) throw new Error('integration insert returned no row');
        if (ciphertext) {
          await tx.insert(integrationCredential).values({
            organizationId: orgId,
            integrationId: row.id,
            ciphertext,
          });
        }
        return row;
      });

      const verified = await verifyIntegration(created);
      return ok(c, McpIntegrationOut, toMcpOut(verified));
    },
  )
  .post(
    '/:id/verify',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Re-verify a remote MCP server',
      capability: 'manage',
      response: McpIntegrationOut,
      description: `Re-run the live \`tools/list\` health check against the org-scoped MCP integration and return the updated {@link McpIntegrationOut} — \`connected\` (with a fresh \`toolCount\`) or \`error\` + \`lastError\`. Use after fixing the remote server or rotating its credential. Requires \`manage\`. 404 for a missing/cross-tenant id.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadMcpIntegration(orgId, id);
      const verified = await verifyIntegration(row);
      return ok(c, McpIntegrationOut, toMcpOut(verified));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Disconnect a remote MCP server',
      capability: 'manage',
      response: z.object({ ok: z.literal(true) }),
      description: `Disconnect the org-scoped MCP integration: the row and its sealed credential are deleted (the credential cascades with the integration). Running sessions keep any results already executed; future toolboxes simply no longer union this server's tools. Requires \`manage\`. 404 for a missing/cross-tenant id.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadMcpIntegration(orgId, id);
      await db.delete(integration).where(eq(integration.id, row.id));
      return ok(c, z.object({ ok: z.literal(true) }), { ok: true });
    },
  );

export default router;
