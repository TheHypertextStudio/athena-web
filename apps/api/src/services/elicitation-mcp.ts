/**
 * `@docket/api` — receiving a third-party MCP server's elicitation and answering it as Athena.
 *
 * @remarks
 * Docket already implements the *server* half of MCP elicitation (`apps/api/src/mcp/elicit.ts`):
 * when Docket is the MCP server, it asks the host client to disambiguate. This module is the other
 * direction, which did not exist — when Athena connects **out** to someone else's MCP server, that
 * server may ask *her* a question, and the spec says a client that wants those questions must
 * advertise the `elicitation` capability and answer with `accept`, `decline`, or `cancel`.
 *
 * The point of routing it through the same elicitation machinery as Athena's own questions rather
 * than auto-answering: a third-party server asking "which repository should I push to?" is a
 * decision taken on the person's behalf, and it earns the same card, the same named action, the
 * same deadline, and the same actionable notification as anything Athena asks herself. The three
 * spec responses map onto the lifecycle exactly:
 *
 * | Docket outcome | MCP response |
 * | --- | --- |
 * | the person answered | `accept` with the parsed content |
 * | the person declined a confirmation | `decline` |
 * | the deadline passed with no derivable answer, or the work was interrupted | `cancel` |
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  UnsupportedElicitationSchemaError,
  elicitationFromMcpRequestedSchema,
  toMcpElicitResult,
  type ElicitationSpec,
  type McpElicitResult,
} from '@docket/athena/elicitation';
import { agentElicitation, db } from '@docket/db';
import { eq } from 'drizzle-orm';

import { raiseElicitation, type ElicitationRow } from './elicitation-service';

/**
 * The client capability Athena advertises so a connected server will ask her things.
 *
 * @remarks
 * A server checks `getClientCapabilities()?.elicitation` before sending `elicitation/create`. Not
 * declaring this is why every third-party question previously fell back to the server's own
 * degraded path without anyone noticing.
 */
export const ELICITATION_CLIENT_CAPABILITY = { elicitation: {} } as const;

/** How often a waiting MCP request re-reads the question's state. */
const DEFAULT_POLL_MS = 500;

/** Everything the bridge needs to raise one third-party question as an Athena question. */
export interface McpElicitationContext {
  /** The Athena session whose tool call triggered the server's question. */
  readonly sessionId: string;
  /** The connected server's display name, used to say who is asking. */
  readonly serverName: string;
  /** How long to hold the MCP request open before answering `cancel`. */
  readonly timeoutMs?: number;
  /** Poll cadence; injectable so a test does not wait half a second per assertion. */
  readonly pollMs?: number;
  /** The clock; injected so tests can fast-forward. */
  readonly now?: () => Date;
}

/** The shape of an `elicitation/create` request's params, per the MCP schema. */
export interface McpElicitParams {
  /** The server's own question text. */
  readonly message: string;
  /** A flat JSON Schema object of primitives describing the answer. */
  readonly requestedSchema: unknown;
}

/**
 * Turn one MCP elicitation request into an Athena question and wait for its answer.
 *
 * @remarks
 * A `requestedSchema` Docket cannot render is answered `cancel` rather than `accept` with a guess —
 * the server then takes its own fallback path, which is the spec's intent, instead of receiving
 * content that does not satisfy the schema it asked for.
 *
 * The action summary names the server, because "someone else's tool is about to act using your
 * account" is exactly the thing a person must be able to see before they answer.
 *
 * @param params - The `elicitation/create` params.
 * @param ctx - See {@link McpElicitationContext}.
 * @returns A spec-conformant `accept` / `decline` / `cancel` result.
 */
export async function handleMcpElicitation(
  params: McpElicitParams,
  ctx: McpElicitationContext,
): Promise<McpElicitResult> {
  let spec: ElicitationSpec;
  try {
    spec = elicitationFromMcpRequestedSchema(params.requestedSchema);
  } catch (error) {
    if (error instanceof UnsupportedElicitationSchemaError) return { action: 'cancel' };
    /* v8 ignore next -- @preserve defensive: the converter throws nothing else */
    throw error;
  }

  const raised = await raiseElicitation({
    sessionId: ctx.sessionId,
    request: {
      question: params.message,
      actionSummary: `Answer ${ctx.serverName} so it can continue on your behalf`,
      spec,
      // A third party's question is never auto-answerable: Docket has no view of what that server
      // will do with the value, so there is no context from which a default could be defensible.
      timeoutPolicy: 'ambiguous',
      autoResolveValue: null,
      autoResolveReason: null,
      timeSensitive: true,
    },
    ...(ctx.timeoutMs !== undefined ? { ttlMs: ctx.timeoutMs } : {}),
    ...(ctx.now ? { now: ctx.now() } : {}),
  });

  const settled = await awaitSettlement(raised.elicitation.id, ctx);
  if (!settled || settled.status === 'parked' || settled.status === 'canceled') {
    return { action: 'cancel' };
  }
  // A confirmation answered "no" is the spec's `decline`: the person said no, which is different
  // from dismissing the dialog, and a server must be able to tell those apart.
  if (spec.kind === 'confirm' && settled.answer === false) return { action: 'decline' };
  if (
    spec.kind === 'form' &&
    spec.fields.length === 1 &&
    spec.fields[0]?.control.kind === 'confirm' &&
    isSingleFalse(settled.answer, spec.fields[0].key)
  ) {
    return { action: 'decline' };
  }
  return toMcpElicitResult('accept', settled.answer);
}

/** Whether a one-field confirmation form was answered "no". */
function isSingleFalse(answer: unknown, key: string): boolean {
  return (
    Boolean(answer) &&
    typeof answer === 'object' &&
    (answer as Record<string, unknown>)[key] === false
  );
}

/** Poll until the question is settled or its own deadline passes. */
async function awaitSettlement(
  elicitationId: string,
  ctx: McpElicitationContext,
): Promise<ElicitationRow | null> {
  const pollMs = ctx.pollMs ?? DEFAULT_POLL_MS;
  const clock = ctx.now ?? ((): Date => new Date());
  for (;;) {
    const rows = await db
      .select()
      .from(agentElicitation)
      .where(eq(agentElicitation.id, elicitationId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.status !== 'pending') return row;
    // Bounded by the question's own persisted deadline rather than a second timer, so the MCP
    // request and the card a person is looking at cannot disagree about when waiting stops.
    if (clock().getTime() >= row.expiresAt.getTime()) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Install the `elicitation/create` handler on one outbound MCP client.
 *
 * @remarks
 * Paired with declaring {@link ELICITATION_CLIENT_CAPABILITY} at client construction — a handler
 * without the capability is never invoked, and a capability without a handler makes the SDK answer
 * "method not found", which a server reads as a broken client rather than an absent feature.
 *
 * @param client - The connected MCP SDK client.
 * @param ctx - See {@link McpElicitationContext}.
 */
export function installElicitationHandler(client: Client, ctx: McpElicitationContext): void {
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    // The SDK's request params are a union — the schema-carrying form and the newer URL-redirect
    // form. Docket renders the schema form in its own chrome; a URL-mode request has nothing to
    // render, so it is cancelled rather than opened, and the server takes its own fallback.
    const params = request.params as { message: string; requestedSchema?: unknown };
    if (params.requestedSchema === undefined) return { action: 'cancel' };
    const result = await handleMcpElicitation(
      { message: params.message, requestedSchema: params.requestedSchema },
      ctx,
    );
    return result as { action: string; content?: Record<string, unknown> };
  });
}
