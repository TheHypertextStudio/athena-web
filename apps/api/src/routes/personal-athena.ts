/**
 * `@docket/api` — owner-only personal Athena routes (`/v1/me/athena`).
 *
 * @remarks
 * Personal connections are keyed only by the authenticated Better Auth user. They are not
 * workspace integrations and a workspace context never participates in their authorization.
 */
import {
  athenaAssignment,
  athenaTrigger,
  db,
  personalMcpConnection,
  personalMcpCredential,
} from '@docket/db';
import { beginMcpOAuthAuthorization, parseMcpOAuthCredential } from '@docket/integrations';
import {
  AthenaAssignmentCreate,
  AthenaAssignmentOut,
  AthenaTriggerCreate,
  AthenaTriggerOut,
  AthenaTriggerUpdate,
  PersonalMcpConnectionCreate,
  PersonalMcpConnectionOut,
  PersonalMcpConnectionPreviewOut,
  PersonalMcpConnectionUpdate,
} from '@docket/types';
import { and, asc, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { sealCredential, unsealCredential } from '../lib/credentials';
import { signConnectState } from '../lib/oauth-state';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import {
  createAthenaAssignment,
  type AthenaAssignmentRow,
  type AthenaTriggerRow,
} from '../agent/assignments';

/** Stored personal connection row. */
export type PersonalMcpConnectionRow = typeof personalMcpConnection.$inferSelect;

/** Return the authenticated owner or fail closed. */
function requestOwner(c: { get(key: 'session'): AppEnv['Variables']['session'] }): string {
  const owner = c.get('session')?.user.id;
  if (!owner) throw new AuthError();
  return owner;
}

/** Serialize a connection without its encrypted credential. */
export function toPersonalMcpOut(
  row: PersonalMcpConnectionRow,
): z.input<typeof PersonalMcpConnectionOut> {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    alias: row.alias,
    authMode: row.authMode,
    status: row.status,
    toolCount: row.toolCount,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load a personal MCP row only when it belongs to the authenticated owner. */
export async function loadPersonalMcpConnection(
  ownerUserId: string,
  id: string,
): Promise<PersonalMcpConnectionRow> {
  const [row] = await db
    .select()
    .from(personalMcpConnection)
    .where(
      and(eq(personalMcpConnection.id, id), eq(personalMcpConnection.ownerUserId, ownerUserId)),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Connection not found');
  return row;
}

/**
 * Earn connection health through a live tools/list round trip using only the owner's credential.
 */
export async function verifyPersonalMcpConnection(
  row: PersonalMcpConnectionRow,
): Promise<PersonalMcpConnectionRow> {
  const [credential] = await db
    .select({ ciphertext: personalMcpCredential.ciphertext })
    .from(personalMcpCredential)
    .where(
      and(
        eq(personalMcpCredential.connectionId, row.id),
        eq(personalMcpCredential.ownerUserId, row.ownerUserId),
      ),
    )
    .limit(1);
  const stored = credential ? unsealCredential(credential.ciphertext) : undefined;
  const oauth = stored ? parseMcpOAuthCredential(stored) : null;
  const bearerToken =
    oauth?.kind === 'mcp_oauth' ? oauth.tokens.access_token : oauth ? undefined : stored;
  let patch: Partial<typeof personalMcpConnection.$inferInsert>;
  try {
    const session = await getContainer().mcpConnector.open({
      url: row.url,
      ...(bearerToken ? { bearerToken } : {}),
    });
    try {
      const tools = await session.listTools();
      patch = { status: 'connected', toolCount: tools.length, lastError: null, lastErrorAt: null };
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
    .update(personalMcpConnection)
    .set(patch)
    .where(
      and(
        eq(personalMcpConnection.id, row.id),
        eq(personalMcpConnection.ownerUserId, row.ownerUserId),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError('Connection not found');
  return updated;
}

const idParam = z.object({ id: z.string() });
const previewInput = z.object({ url: z.url() });
const authorizationOut = z.object({ authorizationUrl: z.url() });
const assignmentStatusUpdate = z.object({ status: z.enum(['active', 'paused', 'completed']) });

/** Serialize one user-owned assignment. */
function toAssignmentOut(row: AthenaAssignmentRow): z.input<typeof AthenaAssignmentOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    entityType: row.entityType,
    entityId: row.entityId,
    objective: row.objective,
    status: row.status,
    activeSessionId: row.activeSessionId,
    pausedReason: row.pausedReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serialize one assignment-scoped trigger. */
function toTriggerOut(row: AthenaTriggerRow): z.input<typeof AthenaTriggerOut> {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    type: row.type,
    eventKinds: AthenaTriggerOut.shape.eventKinds.parse(row.eventKinds),
    scheduleMinutes: row.scheduleMinutes,
    cooldownMinutes: row.cooldownMinutes,
    enabled: row.enabled,
    lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load an assignment by both id and owner, hiding another user's row. */
async function loadAssignment(ownerUserId: string, id: string): Promise<AthenaAssignmentRow> {
  const [row] = await db
    .select()
    .from(athenaAssignment)
    .where(and(eq(athenaAssignment.id, id), eq(athenaAssignment.ownerUserId, ownerUserId)))
    .limit(1);
  if (!row) throw new NotFoundError('Assignment not found');
  return row;
}

/** Load a trigger through its owner-matched assignment. */
async function loadTrigger(
  ownerUserId: string,
  assignmentId: string,
  triggerId: string,
): Promise<AthenaTriggerRow> {
  await loadAssignment(ownerUserId, assignmentId);
  const [row] = await db
    .select()
    .from(athenaTrigger)
    .where(
      and(
        eq(athenaTrigger.id, triggerId),
        eq(athenaTrigger.assignmentId, assignmentId),
        eq(athenaTrigger.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Trigger not found');
  return row;
}

/** OAuth callback used for both personal and workspace-owned MCP clients. */
function oauthRedirectUrl(): string {
  return `${env.API_URL}/internal/integrations/mcp/callback`;
}

/** Public CIMD client metadata URL when Docket is reachable over HTTPS. */
function clientMetadataUrl(): string | undefined {
  return env.API_URL.startsWith('https://')
    ? `${env.API_URL}/.well-known/mcp-client.json`
    : undefined;
}

/** Owner-only personal Athena router. */
const personalAthena = new Hono<AppEnv>()
  .get(
    '/connections',
    apiDoc({
      tag: 'Athena',
      summary: 'List personal Athena connections',
      response: z.array(PersonalMcpConnectionOut),
      description:
        'List remote MCP connections owned by the authenticated user. Connections are reusable by that user’s Athena across workspaces and are never visible to another user.',
    }),
    async (c) => {
      const rows = await db
        .select()
        .from(personalMcpConnection)
        .where(eq(personalMcpConnection.ownerUserId, requestOwner(c)))
        .orderBy(asc(personalMcpConnection.createdAt));
      return ok(c, z.array(PersonalMcpConnectionOut), rows.map(toPersonalMcpOut));
    },
  )
  .post(
    '/connections/preview',
    apiDoc({
      tag: 'Athena',
      summary: 'Discover a personal MCP server name',
      response: PersonalMcpConnectionPreviewOut,
      description:
        'Initialize a remote MCP server without storing it and return its advertised visible name. The caller may edit this name before connecting.',
    }),
    zJson(previewInput),
    async (c) => {
      requestOwner(c);
      const session = await getContainer().mcpConnector.open({ url: c.req.valid('json').url });
      try {
        const info = session.serverInfo();
        return ok(c, PersonalMcpConnectionPreviewOut, { name: info.title ?? info.name });
      } finally {
        await session.close();
      }
    },
  )
  .post(
    '/connections',
    apiDoc({
      tag: 'Athena',
      summary: 'Connect a personal MCP server',
      response: PersonalMcpConnectionOut,
      description:
        'Create a remote MCP connection owned only by the authenticated user. The visible name is required and returned on every response; credentials are AES-256-GCM encrypted and never returned.',
    }),
    zJson(PersonalMcpConnectionCreate),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const body = c.req.valid('json');
      const duplicate = await db
        .select({ id: personalMcpConnection.id })
        .from(personalMcpConnection)
        .where(
          and(
            eq(personalMcpConnection.ownerUserId, ownerUserId),
            or(
              eq(personalMcpConnection.alias, body.alias),
              eq(personalMcpConnection.url, body.url),
            ),
          ),
        )
        .limit(1);
      if (duplicate[0]) throw new ConflictError('This personal MCP connection already exists');
      const ciphertext = body.bearerToken ? sealCredential(body.bearerToken) : null;
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(personalMcpConnection)
          .values({
            ownerUserId,
            name: body.name,
            alias: body.alias,
            url: body.url,
            authMode: body.authMode,
            status: 'pending',
          })
          .returning();
        if (!row) throw new Error('personal connection insert returned no row');
        if (ciphertext) {
          await tx.insert(personalMcpCredential).values({
            connectionId: row.id,
            ownerUserId,
            ciphertext,
          });
        }
        return row;
      });
      const output =
        body.authMode === 'oauth' ? created : await verifyPersonalMcpConnection(created);
      return ok(c, PersonalMcpConnectionOut, toPersonalMcpOut(output));
    },
  )
  .patch(
    '/connections/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Edit a personal MCP connection',
      response: PersonalMcpConnectionOut,
      description:
        'Edit the visible name or model-facing tool prefix of one connection owned by the authenticated user. The URL, authentication mode, and encrypted credential are unchanged.',
    }),
    zParam(idParam),
    zJson(PersonalMcpConnectionUpdate),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const row = await loadPersonalMcpConnection(ownerUserId, id);
      if (body.alias && body.alias !== row.alias) {
        const [duplicate] = await db
          .select({ id: personalMcpConnection.id })
          .from(personalMcpConnection)
          .where(
            and(
              eq(personalMcpConnection.ownerUserId, ownerUserId),
              eq(personalMcpConnection.alias, body.alias),
            ),
          )
          .limit(1);
        if (duplicate) throw new ConflictError('This tool prefix is already in use');
      }
      const [updated] = await db
        .update(personalMcpConnection)
        .set(body)
        .where(
          and(eq(personalMcpConnection.id, id), eq(personalMcpConnection.ownerUserId, ownerUserId)),
        )
        .returning();
      if (!updated) throw new NotFoundError('Connection not found');
      return ok(c, PersonalMcpConnectionOut, toPersonalMcpOut(updated));
    },
  )
  .post(
    '/connections/:id/authorize',
    apiDoc({
      tag: 'Athena',
      summary: 'Authorize a personal MCP connection',
      response: authorizationOut,
      description:
        'Start OAuth approval for an owner-matched personal MCP connection. Encrypted PKCE and discovery state is bound to the connection and user until the signed callback completes.',
    }),
    zParam(idParam),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const row = await loadPersonalMcpConnection(ownerUserId, c.req.valid('param').id);
      if (row.authMode !== 'oauth') throw new ConflictError('This connection does not use OAuth');
      const begun = await beginMcpOAuthAuthorization({
        serverUrl: row.url,
        redirectUrl: oauthRedirectUrl(),
        ...(clientMetadataUrl() ? { clientMetadataUrl: clientMetadataUrl() } : {}),
        state: signConnectState({ scope: 'personal', personalConnectionId: row.id, ownerUserId }),
      });
      const ciphertext = sealCredential(JSON.stringify(begun.credential));
      await db
        .insert(personalMcpCredential)
        .values({ connectionId: row.id, ownerUserId, ciphertext })
        .onConflictDoUpdate({
          target: personalMcpCredential.connectionId,
          set: { ownerUserId, ciphertext },
        });
      return ok(c, authorizationOut, { authorizationUrl: begun.authorizationUrl });
    },
  )
  .post(
    '/connections/:id/reconnect',
    apiDoc({
      tag: 'Athena',
      summary: 'Reconnect a personal MCP server',
      response: PersonalMcpConnectionOut,
      description:
        'Run a fresh tools/list health check with this owner’s stored credential. Another user receives not found, and connection health is earned only after the remote round trip succeeds.',
    }),
    zParam(idParam),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const row = await loadPersonalMcpConnection(ownerUserId, c.req.valid('param').id);
      const verified = await verifyPersonalMcpConnection(row);
      return ok(c, PersonalMcpConnectionOut, toPersonalMcpOut(verified));
    },
  )
  .delete(
    '/connections/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Delete a personal MCP connection',
      response: z.object({ ok: z.literal(true) }),
      description:
        'Delete an owner-matched personal connection and cascade-delete its encrypted credential. Future Athena toolboxes for the owner stop loading its remote tools immediately.',
    }),
    zParam(idParam),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const row = await loadPersonalMcpConnection(ownerUserId, c.req.valid('param').id);
      await db
        .delete(personalMcpConnection)
        .where(
          and(
            eq(personalMcpConnection.id, row.id),
            eq(personalMcpConnection.ownerUserId, ownerUserId),
          ),
        );
      return ok(c, z.object({ ok: z.literal(true) }), { ok: true });
    },
  )
  .get(
    '/assignments',
    apiDoc({
      tag: 'Athena',
      summary: 'List personal Athena assignments',
      response: z.array(AthenaAssignmentOut),
      description:
        'List only the authenticated user’s Athena delegations. Athena is not a workspace assignee or Actor; human ownership on the target work remains unchanged.',
    }),
    async (c) => {
      const rows = await db
        .select()
        .from(athenaAssignment)
        .where(eq(athenaAssignment.ownerUserId, requestOwner(c)))
        .orderBy(asc(athenaAssignment.createdAt));
      return ok(c, z.array(AthenaAssignmentOut), rows.map(toAssignmentOut));
    },
  )
  .post(
    '/assignments',
    apiDoc({
      tag: 'Athena',
      summary: 'Assign personal Athena to work',
      response: AthenaAssignmentOut,
      description:
        'Create a private, user-owned delegation for an initiative, project, or task. The server rechecks the owner’s current contribute access, preserves the human owner/lead/assignee, creates a personal notice, and starts an owner-attributed durable Athena run.',
    }),
    zJson(AthenaAssignmentCreate),
    async (c) => {
      const body = c.req.valid('json');
      const row = await createAthenaAssignment({ ownerUserId: requestOwner(c), ...body });
      return ok(c, AthenaAssignmentOut, toAssignmentOut(row));
    },
  )
  .get(
    '/assignments/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Get a personal Athena assignment',
      response: AthenaAssignmentOut,
      description:
        'Return one private Athena delegation only when it belongs to the authenticated user. Workspace peers cannot read its objective, progress linkage, or trigger state.',
    }),
    zParam(idParam),
    async (c) => {
      const row = await loadAssignment(requestOwner(c), c.req.valid('param').id);
      return ok(c, AthenaAssignmentOut, toAssignmentOut(row));
    },
  )
  .patch(
    '/assignments/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Pause or resume a personal Athena assignment',
      response: AthenaAssignmentOut,
      description:
        'Change the lifecycle of an owner-matched delegation. Pausing or completing it also disables its triggers; resuming never restores authority or silently re-enables old triggers.',
    }),
    zParam(idParam),
    zJson(assignmentStatusUpdate),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const row = await loadAssignment(ownerUserId, c.req.valid('param').id);
      const status = c.req.valid('json').status;
      const [updated] = await db
        .update(athenaAssignment)
        .set({ status, pausedReason: status === 'paused' ? 'owner_paused' : null })
        .where(and(eq(athenaAssignment.id, row.id), eq(athenaAssignment.ownerUserId, ownerUserId)))
        .returning();
      if (!updated) throw new NotFoundError('Assignment not found');
      if (status !== 'active') {
        await db
          .update(athenaTrigger)
          .set({ enabled: false })
          .where(
            and(eq(athenaTrigger.assignmentId, row.id), eq(athenaTrigger.ownerUserId, ownerUserId)),
          );
      }
      return ok(c, AthenaAssignmentOut, toAssignmentOut(updated));
    },
  )
  .delete(
    '/assignments/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Remove a personal Athena assignment',
      response: z.object({ ok: z.literal(true) }),
      description:
        'Delete one owner-matched delegation and cascade its assignment-scoped triggers. Shared Docket work and its human owner, lead, or assignee are never changed.',
    }),
    zParam(idParam),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const row = await loadAssignment(ownerUserId, c.req.valid('param').id);
      await db
        .delete(athenaAssignment)
        .where(and(eq(athenaAssignment.id, row.id), eq(athenaAssignment.ownerUserId, ownerUserId)));
      return ok(c, z.object({ ok: z.literal(true) }), { ok: true });
    },
  )
  .get(
    '/assignments/:id/triggers',
    apiDoc({
      tag: 'Athena',
      summary: 'List assignment triggers',
      response: z.array(AthenaTriggerOut),
      description:
        'List event and scheduled triggers belonging to one owner-matched assignment. Their effective scope is always the assignment entity’s current subtree.',
    }),
    zParam(idParam),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const assignment = await loadAssignment(ownerUserId, c.req.valid('param').id);
      const rows = await db
        .select()
        .from(athenaTrigger)
        .where(
          and(
            eq(athenaTrigger.assignmentId, assignment.id),
            eq(athenaTrigger.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(asc(athenaTrigger.createdAt));
      return ok(c, z.array(AthenaTriggerOut), rows.map(toTriggerOut));
    },
  )
  .post(
    '/assignments/:id/triggers',
    apiDoc({
      tag: 'Athena',
      summary: 'Add an assignment trigger',
      response: AthenaTriggerOut,
      description:
        'Add an event or recurring trigger scoped to this assignment’s live entity subtree. Scheduled cadence and every cooldown are at least five minutes.',
    }),
    zParam(idParam),
    zJson(AthenaTriggerCreate),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const assignment = await loadAssignment(ownerUserId, c.req.valid('param').id);
      const body = c.req.valid('json');
      const now = new Date();
      const [created] = await db
        .insert(athenaTrigger)
        .values({
          assignmentId: assignment.id,
          ownerUserId,
          type: body.type,
          eventKinds: body.type === 'event' ? body.eventKinds : [],
          scheduleMinutes: body.type === 'scheduled' ? body.scheduleMinutes : null,
          cooldownMinutes: body.cooldownMinutes,
          nextRunAt:
            body.type === 'scheduled'
              ? new Date(now.getTime() + body.scheduleMinutes * 60_000)
              : null,
        })
        .returning();
      if (!created) throw new Error('trigger insert returned no row');
      return ok(c, AthenaTriggerOut, toTriggerOut(created));
    },
  )
  .patch(
    '/assignments/:id/triggers/:triggerId',
    apiDoc({
      tag: 'Athena',
      summary: 'Pause or resume an assignment trigger',
      response: AthenaTriggerOut,
      description:
        'Pause or resume a trigger only through its authenticated owner and assignment. Resuming does not bypass the owner access check performed when the trigger fires.',
    }),
    zParam(z.object({ id: z.string(), triggerId: z.string() })),
    zJson(AthenaTriggerUpdate),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const { id, triggerId } = c.req.valid('param');
      const row = await loadTrigger(ownerUserId, id, triggerId);
      const [updated] = await db
        .update(athenaTrigger)
        .set({ enabled: c.req.valid('json').enabled })
        .where(and(eq(athenaTrigger.id, row.id), eq(athenaTrigger.ownerUserId, ownerUserId)))
        .returning();
      if (!updated) throw new NotFoundError('Trigger not found');
      return ok(c, AthenaTriggerOut, toTriggerOut(updated));
    },
  )
  .delete(
    '/assignments/:id/triggers/:triggerId',
    apiDoc({
      tag: 'Athena',
      summary: 'Remove an assignment trigger',
      response: z.object({ ok: z.literal(true) }),
      description:
        'Remove one trigger only when both its assignment and trigger row belong to the authenticated user. Another user receives an existence-hiding not-found response.',
    }),
    zParam(z.object({ id: z.string(), triggerId: z.string() })),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const { id, triggerId } = c.req.valid('param');
      const row = await loadTrigger(ownerUserId, id, triggerId);
      await db
        .delete(athenaTrigger)
        .where(and(eq(athenaTrigger.id, row.id), eq(athenaTrigger.ownerUserId, ownerUserId)));
      return ok(c, z.object({ ok: z.literal(true) }), { ok: true });
    },
  );

export default personalAthena;
