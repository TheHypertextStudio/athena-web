/** Server-owned execution registration for automated canonical template authoring. */
import { isDeepStrictEqual } from 'node:util';
import {
  actor,
  agent,
  agentSession,
  auditEvent,
  db,
  hub,
  sessionActivity,
  type Database,
} from '@docket/db';
import { HubPreferences, type AthenaApprovalMode } from '@docket/planning/hub-preferences-contract';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { CapabilityError, NotFoundError } from '../error';
import { requireTemplateAuthor } from '../lib/templates/authorization';
import { assertProductCapability } from '../product-capability';
import type { McpActor, McpContext } from '../mcp/auth';
import { defineTemplateDefinition } from '../mcp/template-tools-contract';
import { UndoInput } from '../mcp/undo-tools-contract';

const sessions = new WeakMap<McpContext, string | null>();
const operationSchemas = {
  define_template: z.object(defineTemplateDefinition.inputSchema),
  undo: UndoInput,
};

/** Canonicalize both persisted review input and dispatch input with the actual operation schema. */
function reviewedInput(input: unknown, operation: keyof typeof operationSchemas): unknown {
  const parsed = operationSchemas[operation].safeParse(input);
  return parsed.success ? (JSON.parse(JSON.stringify(parsed.data)) as unknown) : null;
}

/** Register only the actual in-process toolbox context; JSON cannot mint this association. */
export function registerTemplateExecutor(ctx: McpContext, sessionId: string | null): void {
  sessions.set(ctx, sessionId);
}

/** Return the session bound to this actual in-process executor after its write authority was checked. */
export function registeredTemplateSessionId(ctx: McpContext): string {
  const sessionId = sessions.get(ctx);
  if (!sessionId) throw new CapabilityError();
  return sessionId;
}

/** Human MCP adapters remain manual; registered agents always require trusted execution. */
export function isAutomatedTemplateContext(ctx: McpContext): boolean {
  return sessions.has(ctx) || ctx.principal.kind === 'agent';
}

/** Load a real active member for the target workspace, independently of the session framing. */
async function currentExecutor(ctx: McpContext, author: McpActor, database: Database) {
  const [member] = await database
    .select()
    .from(actor)
    .where(
      and(
        eq(actor.id, author.actorId),
        eq(actor.organizationId, author.orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!member) throw new NotFoundError();
  if (ctx.principal.kind === 'user') {
    if (member.kind !== 'human' || member.userId !== ctx.principal.userId)
      throw new NotFoundError();
    return { member, registration: null };
  }
  const [registration] = await database
    .select()
    .from(agent)
    .where(
      and(
        eq(agent.id, ctx.principal.agentId),
        eq(agent.organizationId, author.orgId),
        eq(agent.actorId, member.id),
      ),
    )
    .limit(1);
  if (!registration || member.kind !== 'agent') throw new NotFoundError();
  return { member, registration };
}

/** Confirm a human approval of the exact action, never merely an activity ID or model label. */
async function hasReviewedAction(
  database: Database,
  sessionId: string,
  orgId: string,
  input: unknown,
  operation: keyof typeof operationSchemas,
): Promise<boolean> {
  const actions = await database
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.organizationId, orgId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'executing'),
      ),
    );
  const approvals = await database
    .select({ metadata: auditEvent.metadata })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.organizationId, orgId),
        eq(auditEvent.subjectType, 'agent_session'),
        eq(auditEvent.subjectId, sessionId),
        eq(auditEvent.type, 'approved'),
      ),
    );
  const requested = reviewedInput(input, operation);
  if (requested === null) return false;
  return actions.some((activity) => {
    const call = activity.body.action?.toolCall;
    return (
      call?.connection === 'docket' &&
      call.tool === operation &&
      activity.body.action?.mode !== 'suggestion' &&
      isDeepStrictEqual(reviewedInput(call.input, operation), requested) &&
      approvals.some(
        ({ metadata }) =>
          metadata['activityId'] === activity.id && typeof metadata['approverActorId'] === 'string',
      )
    );
  });
}

/** Check the persisted session identity against its server-registered transport principal. */
function requireMatchingSession(
  ctx: McpContext,
  session: typeof agentSession.$inferSelect,
  author: McpActor,
): void {
  if (session.status !== 'running') throw new CapabilityError();
  if (ctx.principal.kind === 'user') {
    if (session.executorKind !== 'athena' || session.ownerUserId !== ctx.principal.userId)
      throw new CapabilityError();
  } else if (
    session.executorKind !== 'registered_agent' ||
    session.agentId !== ctx.principal.agentId ||
    session.organizationId !== author.orgId
  )
    throw new CapabilityError();
}

/** Resolve actual current user preferences for the persisted executor. */
async function executionMode(
  database: Database,
  session: typeof agentSession.$inferSelect,
  member: typeof actor.$inferSelect,
) {
  const userId =
    member.kind === 'human'
      ? member.userId
      : await initiatorUser(database, session.initiatorId, member.organizationId);
  const [preferences] = userId
    ? await database
        .select({ preferences: hub.preferences })
        .from(hub)
        .where(eq(hub.userId, userId))
        .limit(1)
    : [];
  return (
    HubPreferences.parse(preferences?.preferences ?? {}).athena?.approvalMode ?? 'ask_before_acting'
  );
}

/** Destructive reversal always requires review, including under routine draft autonomy. */
function mayDraftAutonomously(
  mode: AthenaApprovalMode,
  policy: typeof agent.$inferSelect.approvalPolicy | undefined,
  operation: string,
): boolean {
  return (
    operation === 'define_template' &&
    mode === 'routine_autonomy' &&
    (policy === undefined || policy === 'autonomous')
  );
}

/**
 * Revalidate persisted execution, target membership, Pro and live authoring on each write.
 * Call again on the transaction that owns the canonical draft and reversible receipt.
 * @throws When execution, approval, current membership, entitlement or policy no longer permits it.
 */
export async function requireAutomatedTemplateAuthor(
  ctx: McpContext,
  author: McpActor,
  input: unknown,
  database: Database = db,
  operation: 'define_template' | 'undo' = 'define_template',
): Promise<void> {
  const sessionId = sessions.get(ctx);
  if (!sessionId) throw new CapabilityError();
  const [session] = await database
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  if (!session) throw new CapabilityError();
  requireMatchingSession(ctx, session, author);
  const { member, registration } = await currentExecutor(ctx, author, database);
  await assertProductCapability(author.orgId, 'athena', database);
  await requireTemplateAuthor(author, database);
  const mode = await executionMode(database, session, member);
  if (mode === 'suggest_only' || registration?.approvalPolicy === 'suggest')
    throw new CapabilityError();
  if (mayDraftAutonomously(mode, registration?.approvalPolicy, operation)) return;
  if (!(await hasReviewedAction(database, session.id, author.orgId, input, operation)))
    throw new CapabilityError();
}

/** Resolve the policy owner from the session's stored same-workspace initiator. */
async function initiatorUser(
  database: Database,
  id: string | null,
  orgId: string,
): Promise<string | null> {
  if (!id) return null;
  const [initiator] = await database
    .select({ userId: actor.userId })
    .from(actor)
    .where(
      and(
        eq(actor.id, id),
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  return initiator?.userId ?? null;
}
