/**
 * `@docket/api` — the Athena agentic loop.
 *
 * @remarks
 * {@link driveSession} is **re-entrant**: every piece of state it needs lives in the
 * database (the `agent_session_transcript`, the `session_activity` rows, the session
 * status), so the first run, resume-after-approval (possibly days later),
 * resume-after-reply, and restart recovery are all the same code path. Each entry
 * starts by **reconciling** the transcript's trailing assistant message: any
 * `tool_use` without a paired result is answered from DB state (an applied action's
 * result, a rejection, an elicitation's human reply) — or, when the answer doesn't
 * exist yet, the session settles (`awaiting_approval` / `awaiting_input`) and the
 * loop stops. Only a fully-answered conversation runs another provider turn.
 *
 * Tool dispatch is governed by the pure {@link decideToolExecution} policy engine;
 * execution goes through the in-process MCP {@link Toolbox} as the agent's own actor,
 * so the scope layer and grant cascade bind every call.
 */
import {
  actor,
  agent,
  agentSession,
  auditEvent,
  db,
  genId,
  hub,
  organization,
  sessionActivity,
  task,
  user,
} from '@docket/db';
import type { SessionActivityBody } from '@docket/db';
import type { AgentTurnRuntime, TurnMessage } from '@docket/agent-runtime';
import { HubPreferences } from '@docket/types';
import type { AthenaApprovalMode, SessionApprovalDecision, TurnContentBlock } from '@docket/types';
import { and, asc, count, eq, gt } from 'drizzle-orm';

import { assertAgentSessionsEntitled } from '../billing/entitlement';
import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { env } from '../env';
import { internalUserContext } from '../mcp/internal-session';
import { resolveActor } from '../mcp/auth';
import { decideActivity, decideProposalGroup } from '../routes/agent-session-approval';
import type { SessionRow } from '../routes/agent-session-helpers';
import { classifyTool, decideUserOwnedToolExecution } from './approval-policy';
import { buildSystemPrompt } from './system-prompt';
import {
  ASK_USER_TOOL,
  DOCKET_CONNECTION,
  openToolbox,
  type ToolboxExecutor,
  type ToolboxResult,
} from './toolbox';
import { loadTranscript, saveTranscript } from './transcript';

/** Injectable dependencies for the loop (tests script the turn runtime). */
export interface LoopDeps {
  /** The provider turn runtime; defaults to the container's `agentTurn` port. */
  readonly turnRuntime?: AgentTurnRuntime;
}

/** Product default for simultaneously running personal Athena sessions. */
export const DEFAULT_ATHENA_CONCURRENCY = 8;

/**
 * Admit a pending session without allowing concurrent Athena runs to oversubscribe one owner.
 *
 * @remarks
 * Athena admission locks the owner's stable user row, then reloads and transitions only this
 * session inside the same short transaction. Re-entrant callers that observe the same session
 * already running continue safely; provider and tool execution always happens after commit.
 */
async function admitSession(session: SessionRow): Promise<void> {
  if (session.executorKind === 'registered_agent') {
    await db
      .update(agentSession)
      .set({ status: 'running', startedAt: session.startedAt ?? new Date() })
      .where(eq(agentSession.id, session.id));
    return;
  }
  if (session.status === 'running') return;

  const ownerUserId = requireAthenaOwner(session);
  await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ownerUserId))
      .for('update');
    if (!owner) throw new NotFoundError('Athena owner not found');

    const [current] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, session.id))
      .limit(1);
    if (!current) throw new NotFoundError('Session not found');
    if (current.executorKind !== 'athena' || current.ownerUserId !== ownerUserId) {
      throw new ConflictError('Session executor changed during admission');
    }
    if (current.status === 'running') return;
    if (current.status !== 'pending') {
      throw new ConflictError('Session is not in a runnable state');
    }

    const [row] = await tx
      .select({ value: count() })
      .from(agentSession)
      .where(
        and(
          eq(agentSession.executorKind, 'athena'),
          eq(agentSession.ownerUserId, ownerUserId),
          eq(agentSession.status, 'running'),
        ),
      );
    const limit = env.ATHENA_MAX_CONCURRENT_RUNS ?? DEFAULT_ATHENA_CONCURRENCY;
    if ((row?.value ?? 0) >= limit) {
      throw new ConflictError('Athena has reached the concurrent run limit');
    }

    const [admitted] = await tx
      .update(agentSession)
      .set({ status: 'running', startedAt: current.startedAt ?? new Date() })
      .where(and(eq(agentSession.id, current.id), eq(agentSession.status, 'pending')))
      .returning({ id: agentSession.id });
    if (!admitted) throw new ConflictError('Session admission changed concurrently');
  });
}

/** A `tool_use` block extracted from an assistant message. */
interface ToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** Resolve caller-owned Athena preferences from the persisted session executor. */
async function principalAthenaPreferences(session: SessionRow): Promise<{
  readonly approvalMode: AthenaApprovalMode;
  readonly instructions: string | null;
}> {
  const rows =
    session.executorKind === 'athena'
      ? await db
          .select({ preferences: hub.preferences })
          .from(hub)
          .where(eq(hub.userId, requireAthenaOwner(session)))
          .limit(1)
      : session.initiatorId
        ? await db
            .select({ preferences: hub.preferences })
            .from(actor)
            .innerJoin(hub, eq(actor.userId, hub.userId))
            .where(eq(actor.id, session.initiatorId))
            .limit(1)
        : [];
  const preferences = HubPreferences.parse(rows[0]?.preferences ?? {});
  const instructions = preferences.athena?.instructions?.trim();
  return {
    approvalMode: preferences.athena?.approvalMode ?? 'ask_before_acting',
    instructions: instructions && instructions.length > 0 ? instructions : null,
  };
}

/** Return the workspace named by a Docket tool input, when present. */
function toolOrganizationId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)['orgId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Build the toolbox identity exclusively from the persisted executor columns. */
function toolboxExecutor(session: SessionRow): ToolboxExecutor {
  if (session.executorKind === 'athena') {
    if (!session.ownerUserId) throw new Error('Athena session is missing its owner');
    return { kind: 'athena', ownerUserId: session.ownerUserId };
  }
  if (!session.organizationId || !session.agentId) {
    throw new Error('Registered-agent session is missing its workspace identity');
  }
  return {
    kind: 'registered_agent',
    organizationId: session.organizationId,
    agentId: session.agentId,
  };
}

/** Return an Athena owner after checking the persisted executor shape. */
function requireAthenaOwner(session: SessionRow): string {
  if (session.executorKind !== 'athena' || !session.ownerUserId) {
    throw new Error('Athena session is missing its owner');
  }
  return session.ownerUserId;
}

/** Return a registered agent id after checking the persisted executor shape. */
function requireRegisteredAgentId(session: SessionRow): string {
  if (session.executorKind !== 'registered_agent' || !session.agentId) {
    throw new Error('Registered-agent session is missing its agent');
  }
  return session.agentId;
}

/** Workspace attribution for personal-neutral versus registered-agent activity. */
function generalActivityOrganizationId(session: SessionRow): string | null {
  return session.executorKind === 'athena' ? null : session.organizationId;
}

/** Extract the tool_use blocks of a message. */
function toolUsesOf(message: TurnMessage): ToolUse[] {
  return message.content.flatMap((b) =>
    b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [],
  );
}

/** Turn a `snake_case` tool identifier into a lowercase phrase, e.g. `update_task` → `update task`. */
function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

/** Build a human-readable one-line summary for a tool call (the UI's action headline). */
function summarizeToolCall(name: string, input: unknown): string {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const title = typeof obj['title'] === 'string' ? obj['title'] : undefined;
  const phrase = humanizeToolName(name);
  return title ? `${phrase}: "${title}"` : phrase;
}

/** Settle a session's status (single writer for status/endedAt consistency). */
async function settleSession(
  sessionId: string,
  status: 'running' | 'awaiting_input' | 'awaiting_approval' | 'completed' | 'failed',
): Promise<SessionRow> {
  const terminal = status === 'completed' || status === 'failed';
  const [row] = await db
    .update(agentSession)
    .set({ status, ...(terminal ? { endedAt: new Date() } : {}) })
    .where(eq(agentSession.id, sessionId))
    .returning();
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!row) throw new Error('session update returned no row');
  return row;
}

/** Insert one activity row and return it. */
async function insertActivity(
  organizationId: string | null,
  sessionId: string,
  type: 'thought' | 'response' | 'elicitation' | 'error' | 'action',
  body: SessionActivityBody,
  extras: { approvalStatus?: 'proposed' | 'applied'; proposalGroupId?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(sessionActivity)
    .values({ sessionId, organizationId, type, body, ...extras })
    .returning({ id: sessionActivity.id });
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('activity insert returned no row');
  return row.id;
}

/** Write the audit row for one agent-executed tool call. */
async function auditExecution(
  orgId: string,
  sessionId: string,
  executor: ToolboxExecutor,
  registeredAgentActorId: string | null,
  initiatorId: string | null,
  activityId: string,
  tool: string,
): Promise<void> {
  const ownerUserId = executor.kind === 'athena' ? executor.ownerUserId : null;
  const authorizationActorId =
    executor.kind === 'athena'
      ? (await resolveActor(await internalUserContext(executor.ownerUserId), orgId)).actorId
      : registeredAgentActorId;
  await db.insert(auditEvent).values({
    organizationId: orgId,
    actorId: authorizationActorId,
    initiatorId,
    subjectType: 'agent_session',
    subjectId: sessionId,
    type: 'updated',
    metadata: {
      activityId,
      tool,
      ...(ownerUserId
        ? {
            executionOrigin: 'athena',
            athenaSessionId: sessionId,
            requestedByUserId: ownerUserId,
          }
        : {}),
    },
  });
}

/** The reconciliation outcome for one unanswered tool_use. */
type Reconciled =
  | { readonly kind: 'result'; readonly result: ToolboxResult }
  | { readonly kind: 'await_approval' }
  | { readonly kind: 'await_input' };

/**
 * Answer one unanswered `tool_use` from DB state, or report what it is waiting on.
 */
async function reconcileToolUse(sessionId: string, use: ToolUse): Promise<Reconciled> {
  if (use.name === ASK_USER_TOOL) {
    const prompts = await db
      .select({ id: sessionActivity.id, createdAt: sessionActivity.createdAt })
      .from(sessionActivity)
      .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'elicitation')))
      .orderBy(asc(sessionActivity.createdAt));
    const prompt = (
      await Promise.all(
        prompts.map(async (p) => {
          const rows = await db
            .select({ body: sessionActivity.body })
            .from(sessionActivity)
            .where(eq(sessionActivity.id, p.id));
          return { ...p, toolUseId: rows[0]?.body['toolUseId'] };
        }),
      )
    ).find((p) => p.toolUseId === use.id);
    if (!prompt) return { kind: 'await_input' };
    const replies = await db
      .select({ body: sessionActivity.body })
      .from(sessionActivity)
      .where(
        and(
          eq(sessionActivity.sessionId, sessionId),
          eq(sessionActivity.type, 'response'),
          gt(sessionActivity.createdAt, prompt.createdAt),
        ),
      )
      .orderBy(asc(sessionActivity.createdAt))
      .limit(1);
    const reply = replies[0]?.body.text;
    if (!reply) return { kind: 'await_input' };
    return { kind: 'result', result: { content: reply, isError: false } };
  }

  const actions = await db
    .select({ body: sessionActivity.body, approvalStatus: sessionActivity.approvalStatus })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'action')));
  const action = actions.find((a) => a.body.action?.toolCall?.toolUseId === use.id);
  /* v8 ignore next 2 -- @preserve defensive: every tool_use gets an action row in the same turn */
  if (!action) return { kind: 'result', result: { content: 'Result unavailable.', isError: true } };

  if (action.approvalStatus === 'applied') {
    const result = action.body.action?.result;
    return {
      kind: 'result',
      result: { content: result?.content ?? 'Applied.', isError: result?.isError ?? false },
    };
  }
  if (action.approvalStatus === 'rejected') {
    return {
      kind: 'result',
      result: {
        content: 'Rejected by the approver. Adapt your plan; do not retry the same change.',
        isError: true,
      },
    };
  }
  if (action.body.action?.mode === 'suggestion') {
    return {
      kind: 'result',
      result: {
        content: 'Recorded as a suggestion for human review; NOT executed. Continue.',
        isError: false,
      },
    };
  }
  // A proposal still awaiting a decision (or an `approved` row whose execution is in
  // flight) parks the session.
  return { kind: 'await_approval' };
}

/**
 * Drive one agent session forward until it settles.
 *
 * @remarks
 * Re-entrant (see module remarks). Callable when the session is `pending` (first run)
 * or `running` (resumed by an approval/reply); any other state conflicts.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session to drive.
 * @param deps - Injectable turn runtime (tests script it).
 * @returns the settled session row.
 * @throws {NotFoundError} When the session or its agent is not found in the org.
 * @throws {ConflictError} When the session is not in a runnable state.
 */
export async function driveSession(
  orgId: string,
  sessionId: string,
  deps: LoopDeps = {},
): Promise<SessionRow> {
  const sessionRows = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) throw new NotFoundError('Session not found');
  if (session.executorKind === 'registered_agent' && session.organizationId !== orgId) {
    throw new NotFoundError('Session not found');
  }
  if (
    session.executorKind === 'athena' &&
    session.contextOrganizationId !== null &&
    session.contextOrganizationId !== orgId
  ) {
    throw new NotFoundError('Session not found');
  }
  if (session.status !== 'pending' && session.status !== 'running') {
    throw new ConflictError('Session is not in a runnable state');
  }
  const executor = toolboxExecutor(session);
  const agentRow =
    session.executorKind === 'registered_agent'
      ? (
          await db
            .select({
              approvalPolicy: agent.approvalPolicy,
              guidance: agent.guidance,
              displayName: actor.displayName,
              actorId: actor.id,
            })
            .from(agent)
            .innerJoin(actor, eq(agent.actorId, actor.id))
            .where(
              and(eq(agent.id, requireRegisteredAgentId(session)), eq(agent.organizationId, orgId)),
            )
            .limit(1)
        )[0]
      : {
          approvalPolicy: 'autonomous' as const,
          guidance: null,
          displayName: 'Athena',
          actorId: null,
        };
  if (!agentRow) throw new NotFoundError('Agent not found');

  const contextOrganizationId =
    session.executorKind === 'athena' ? session.contextOrganizationId : session.organizationId;
  const orgRows = contextOrganizationId
    ? await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, contextOrganizationId))
        .limit(1)
    : [];
  const contextName = orgRows[0]?.name ?? null;
  const principalPreferences = await principalAthenaPreferences(session);

  const maxTurns = env.AGENT_MAX_TURNS;

  // Paid-plan gate, only on a session's FIRST run: every door (REST, the trigger_agent
  // MCP tool, the proactive sweep) funnels through here, and resumes of an
  // already-started session are deliberately exempt so an approval arriving after a
  // plan lapse still lands the work the user already reviewed.
  if (session.startedAt === null) {
    if (contextOrganizationId) await assertAgentSessionsEntitled(contextOrganizationId);
  }

  await admitSession(session);

  const turnRuntime = deps.turnRuntime ?? getContainer().agentTurn;
  const toolbox = await openToolbox(executor);
  try {
    let messages = await loadTranscript(db, sessionId);
    if (messages.length === 0) {
      messages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: await deriveBrief(contextOrganizationId, session.taskId, sessionId),
            },
          ],
        },
      ];
      await saveTranscript(
        db,
        sessionId,
        generalActivityOrganizationId(session),
        messages,
        session.ownerUserId,
      );
    }

    const system = buildSystemPrompt({
      agentName: agentRow.displayName,
      executorKind: session.executorKind,
      contextName,
      approvalPolicy: agentRow.approvalPolicy,
      personalApprovalMode: principalPreferences.approvalMode,
      personalInstructions: principalPreferences.instructions,
      guidance: agentRow.guidance,
    });

    for (;;) {
      // ── Reconcile: answer the trailing assistant message's tool_uses from DB state.
      const last = messages.at(-1);
      if (last?.role === 'assistant') {
        const uses = toolUsesOf(last);
        if (uses.length > 0) {
          const results: TurnContentBlock[] = [];
          for (const use of uses) {
            const outcome = await reconcileToolUse(sessionId, use);
            if (outcome.kind === 'await_approval') {
              return await settleSession(sessionId, 'awaiting_approval');
            }
            if (outcome.kind === 'await_input') {
              return await settleSession(sessionId, 'awaiting_input');
            }
            results.push({
              type: 'tool_result',
              toolUseId: use.id,
              content: outcome.result.content,
              isError: outcome.result.isError,
            });
          }
          messages = [...messages, { role: 'user', content: results }];
          await saveTranscript(
            db,
            sessionId,
            generalActivityOrganizationId(session),
            messages,
            session.ownerUserId,
          );
        } else {
          // A trailing assistant message with no tool calls is a finished job.
          return await settleSession(sessionId, await finalStatus(sessionId));
        }
      }

      // ── Between turns: honor pause/cancel/takeover flips made while we worked.
      const statusRows = await db
        .select({ status: agentSession.status })
        .from(agentSession)
        .where(eq(agentSession.id, sessionId))
        .limit(1);
      if (statusRows[0]?.status !== 'running') {
        const rows = await db
          .select()
          .from(agentSession)
          .where(eq(agentSession.id, sessionId))
          .limit(1);
        /* v8 ignore next -- @preserve defensive: the session row exists */
        if (!rows[0]) throw new Error('session vanished mid-run');
        return rows[0];
      }

      // ── Turn budget (explicit config; no hidden default).
      const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
      if (assistantTurns >= maxTurns) {
        await insertActivity(generalActivityOrganizationId(session), sessionId, 'error', {
          text: `Turn budget exhausted (${String(maxTurns)} turns); stopping the session.`,
        });
        return await settleSession(sessionId, 'failed');
      }

      // ── One provider turn.
      let assistantMessage: TurnMessage | undefined;
      let stopReason = 'end_turn';
      for await (const event of turnRuntime.streamTurn({
        system,
        messages,
        tools: toolbox.tools,
      })) {
        if (event.type === 'thinking') {
          await insertActivity(generalActivityOrganizationId(session), sessionId, 'thought', {
            text: event.text,
          });
        } else if (event.type === 'text') {
          await insertActivity(generalActivityOrganizationId(session), sessionId, 'response', {
            text: event.text,
          });
        } else if (event.type === 'turn_end') {
          assistantMessage = event.message;
          stopReason = event.stopReason;
        }
      }
      /* v8 ignore next -- @preserve defensive: every turn ends with turn_end */
      if (!assistantMessage) throw new Error('turn ended without a terminal message');

      if (stopReason === 'refusal') {
        await insertActivity(generalActivityOrganizationId(session), sessionId, 'error', {
          text: 'The agent declined to complete this task (model refusal).',
        });
        return await settleSession(sessionId, 'failed');
      }
      if (stopReason === 'max_tokens') {
        await insertActivity(generalActivityOrganizationId(session), sessionId, 'error', {
          text: 'The turn exceeded the output limit before completing.',
        });
        return await settleSession(sessionId, 'failed');
      }

      messages = [...messages, assistantMessage];
      const uses = toolUsesOf(assistantMessage);
      const proposalGroupId = genId();

      // Persist the transcript and the gated/elicitation rows atomically, so a crash
      // between "model asked" and "rows exist" cannot strand an unanswerable tool_use.
      await db.transaction(async (tx) => {
        await saveTranscript(
          tx,
          sessionId,
          generalActivityOrganizationId(session),
          messages,
          session.ownerUserId,
        );
        for (const use of uses) {
          if (use.name === ASK_USER_TOOL) {
            const input = use.input as { question?: string };
            await tx.insert(sessionActivity).values({
              sessionId,
              organizationId: generalActivityOrganizationId(session),
              type: 'elicitation',
              body: { text: input.question ?? 'The agent needs your input.', toolUseId: use.id },
            });
            continue;
          }
          const decision = decideUserOwnedToolExecution(
            agentRow.approvalPolicy,
            principalPreferences.approvalMode,
            classifyTool(toolbox.annotations(use.name)),
          );
          if (decision === 'execute') continue; // executed (and recorded) below, post-commit
          const target = toolbox.resolve(use.name);
          await tx.insert(sessionActivity).values({
            sessionId,
            organizationId:
              session.executorKind === 'athena'
                ? toolOrganizationId(use.input)
                : session.organizationId,
            type: 'action',
            approvalStatus: 'proposed',
            proposalGroupId,
            body: {
              action: {
                kind: use.name,
                summary: summarizeToolCall(use.name, use.input),
                toolCall: {
                  connection: target.connection,
                  tool: target.rawName,
                  input: use.input,
                  toolUseId: use.id,
                },
                mode: decision === 'record_only' ? 'suggestion' : 'proposal',
              },
            },
          });
        }
      });

      // Execute the immediately-runnable calls (reads everywhere; writes when
      // autonomous), recording each as an applied action with its result + audit row.
      for (const use of uses) {
        if (use.name === ASK_USER_TOOL) continue;
        const decision = decideUserOwnedToolExecution(
          agentRow.approvalPolicy,
          principalPreferences.approvalMode,
          classifyTool(toolbox.annotations(use.name)),
        );
        if (decision !== 'execute') continue;
        const result = await toolbox.callTool(use.name, use.input);
        const target = toolbox.resolve(use.name);
        const actionOrganizationId =
          session.executorKind === 'athena'
            ? toolOrganizationId(use.input)
            : session.organizationId;
        const activityId = await insertActivity(
          actionOrganizationId,
          sessionId,
          'action',
          {
            action: {
              kind: use.name,
              summary: summarizeToolCall(use.name, use.input),
              toolCall: {
                connection: target.connection,
                tool: target.rawName,
                input: use.input,
                toolUseId: use.id,
              },
              result: { content: result.content, isError: result.isError },
              mode: 'proposal',
            },
          },
          { approvalStatus: 'applied' },
        );
        if (!result.isError && actionOrganizationId) {
          await auditExecution(
            actionOrganizationId,
            sessionId,
            executor,
            agentRow.actorId,
            session.initiatorId,
            activityId,
            use.name,
          );
        }
      }
      // The loop's next iteration reconciles: fully-answered turns continue; a pending
      // proposal settles awaiting_approval; an ask_user settles awaiting_input.
    }
  } finally {
    await toolbox.close();
  }
}

/** Whether any still-proposed action remains (suggest-mode leftovers included). */
async function finalStatus(sessionId: string): Promise<'completed' | 'awaiting_approval'> {
  const remaining = await db
    .select({ id: sessionActivity.id })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'proposed'),
      ),
    )
    .limit(1);
  return remaining.length > 0 ? 'awaiting_approval' : 'completed';
}

/** Derive the runtime brief: linked task title → seeded prompt → session id. */
async function deriveBrief(
  orgId: string | null,
  taskId: string | null,
  sessionId: string,
): Promise<string> {
  if (taskId && orgId) {
    const rows = await db
      .select({ title: task.title })
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
      .limit(1);
    if (rows[0]) return rows[0].title;
  }
  const prompts = await db
    .select({ body: sessionActivity.body })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'response')))
    .orderBy(asc(sessionActivity.createdAt))
    .limit(1);
  return prompts[0]?.body.text ?? sessionId;
}

/**
 * Execute every `approved` action of a session: run its stored `toolCall` as the agent
 * actor, stamp the row `applied` with the result, and audit it.
 *
 * @remarks
 * Approved rows without a `toolCall` (legacy narration-only actions) are stamped
 * `applied` directly. Executions run in activity order so a batch lands
 * deterministically.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session whose approved actions should execute.
 */
export async function executeApprovedActions(orgId: string, sessionId: string): Promise<void> {
  const sessionRows = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) throw new NotFoundError('Session not found');
  if (session.executorKind === 'registered_agent' && session.organizationId !== orgId) {
    throw new NotFoundError('Session not found');
  }
  if (
    session.executorKind === 'athena' &&
    session.contextOrganizationId !== null &&
    session.contextOrganizationId !== orgId
  ) {
    throw new NotFoundError('Session not found');
  }
  const executor = toolboxExecutor(session);

  const approved = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'approved'),
      ),
    )
    .orderBy(asc(sessionActivity.createdAt));
  if (approved.length === 0) return;

  const agentRows =
    session.executorKind === 'registered_agent'
      ? await db
          .select({ actorId: agent.actorId })
          .from(agent)
          .where(eq(agent.id, requireRegisteredAgentId(session)))
          .limit(1)
      : [];
  const registeredAgentActorId = agentRows[0]?.actorId ?? null;

  const withCalls = approved.filter((a) => a.body.action?.toolCall);
  const toolbox = withCalls.length > 0 ? await openToolbox(executor) : null;
  try {
    for (const action of approved) {
      const call = action.body.action?.toolCall;
      let body = action.body;
      let executionFailed = false;
      if (call && toolbox && action.body.action) {
        const name =
          call.connection === DOCKET_CONNECTION ? call.tool : `${call.connection}__${call.tool}`;
        const result = await toolbox.callTool(name, call.input);
        executionFailed = result.isError;
        body = {
          ...action.body,
          action: {
            ...action.body.action,
            result: { content: result.content, isError: result.isError },
          },
        };
      }
      await db
        .update(sessionActivity)
        .set({ approvalStatus: 'applied', body })
        .where(eq(sessionActivity.id, action.id));
      const actionOrganizationId =
        session.executorKind === 'athena'
          ? toolOrganizationId(call?.input)
          : session.organizationId;
      if (!executionFailed && actionOrganizationId) {
        await auditExecution(
          actionOrganizationId,
          sessionId,
          executor,
          registeredAgentActorId,
          session.initiatorId,
          action.id,
          call?.tool ?? action.body.action?.kind ?? 'action',
        );
      }
    }
  } finally {
    if (toolbox) await toolbox.close();
  }
}

/**
 * Decide a whole proposal group (optionally a subset), execute what was approved, and
 * resume the loop when the session came back to `running`.
 *
 * @remarks
 * The batch counterpart of {@link approveAndResume} — the "Approve all N" /
 * "Approve selected" surface behind the ghost system's group review.
 *
 * @param orgId - The active organization id.
 * @param approverActorId - The approver's actor id (audited).
 * @param sessionId - The session that owns the group.
 * @param proposalGroupId - The batch to decide.
 * @param decision - Approve or reject the batch.
 * @param activityIds - Optional subset; omitted decides the whole group.
 * @param deps - Injectable turn runtime (tests script it).
 * @returns the settled session row after any resume.
 */
export async function approveGroupAndResume(
  orgId: string,
  approverActorId: string,
  sessionId: string,
  proposalGroupId: string,
  decision: 'approve' | 'reject',
  activityIds?: readonly string[],
  deps: LoopDeps = {},
): Promise<SessionRow> {
  await decideProposalGroup(
    orgId,
    approverActorId,
    sessionId,
    proposalGroupId,
    decision,
    activityIds,
  );
  await executeApprovedActions(orgId, sessionId);

  const rows = await db.select().from(agentSession).where(eq(agentSession.id, sessionId)).limit(1);
  /* v8 ignore next -- @preserve defensive: decideProposalGroup already 404'd unknown sessions */
  if (!rows[0]) throw new NotFoundError('Session not found');
  if (rows[0].status !== 'running') return rows[0];
  const transcript = await loadTranscript(db, sessionId);
  if (transcript.length === 0) return rows[0];
  return driveSession(orgId, sessionId, deps);
}

/**
 * Decide on a proposed action, execute whatever the decision unlocked, and resume the
 * loop when the session came back to `running`.
 *
 * @remarks
 * The composition the approval routes call: {@link decideActivity} (transactional
 * status flips + audit) → {@link executeApprovedActions} (post-commit tool execution)
 * → {@link driveSession} re-entry, whose reconcile step feeds the results — or the
 * rejection — back to the model.
 *
 * @param orgId - The active organization id.
 * @param approverActorId - The approver's actor id (audited).
 * @param sessionId - The session that owns the activity.
 * @param activityId - The proposed action being decided.
 * @param decision - Approve/reject and its scope.
 * @param deps - Injectable turn runtime (tests script it).
 * @returns the settled session row after any resume.
 */
export async function approveAndResume(
  orgId: string,
  approverActorId: string,
  sessionId: string,
  activityId: string,
  decision: SessionApprovalDecision,
  deps: LoopDeps = {},
): Promise<SessionRow> {
  await decideActivity(orgId, approverActorId, sessionId, activityId, decision);
  await executeApprovedActions(orgId, sessionId);

  const rows = await db.select().from(agentSession).where(eq(agentSession.id, sessionId)).limit(1);
  /* v8 ignore next -- @preserve defensive: decideActivity already 404'd unknown sessions */
  if (!rows[0]) throw new NotFoundError('Session not found');
  if (rows[0].status !== 'running') return rows[0];
  // Only sessions the loop owns (a transcript exists) resume; a hand-created session
  // with no conversation state has nothing to continue.
  const transcript = await loadTranscript(db, sessionId);
  if (transcript.length === 0) return rows[0];
  return driveSession(orgId, sessionId, deps);
}
