/**
 * `@docket/api` — MCP result + authorization helpers shared by tools and resources.
 *
 * @remarks
 * Centralizes two concerns so every tool/resource behaves identically: (1) building
 * the MCP `CallToolResult` / error contract from arbitrary payloads, and (2) running
 * the permission engine ({@link canActor}) before any read or write — translating a
 * denial into the existence-hiding {@link NotFoundError} (below-view) vs
 * {@link CapabilityError} (insufficient) decision the RPC layer makes.
 */
import { type Capability, canActor, type ResourceRef } from '@docket/authz';
import { db } from '@docket/db';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ApiError, CapabilityError, NotFoundError } from '../error';
import type { McpActor, McpContext } from './auth';
import { resolveActor } from './auth';
import { type McpScope, requireScope } from './scope';

/**
 * Build a successful tool result carrying a JSON payload as pretty-printed text.
 *
 * @param data - The structured payload to return to the caller.
 * @returns the MCP {@link CallToolResult} with a single text block.
 */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Build an error tool result (the MCP `isError` contract) from a message.
 *
 * @remarks
 * Tool execution errors are reported via `isError: true` (not a transport error) so
 * the model can see and react to them, per the MCP tool spec.
 *
 * @param message - A human-readable failure description.
 * @returns the MCP {@link CallToolResult} flagged as an error.
 */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Run a tool body, mapping any thrown {@link ApiError} to the `isError` contract.
 *
 * @remarks
 * Domain errors (auth, capability, not-found, conflict, validation) become readable
 * `isError` results; unexpected errors surface a generic message without leaking
 * internals. This keeps every tool handler free of repetitive try/catch.
 *
 * @param body - The tool implementation producing a success result.
 * @returns the body's result, or an error result on failure.
 */
export async function runTool(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof ApiError) return errorResult(`${err.code}: ${err.message}`);
    return errorResult('Internal error');
  }
}

/**
 * Apply the MCP scope layer, then resolve the caller's per-org Actor (the grant layer).
 *
 * @remarks
 * The single entry point that enforces mcp-surface.md §2.2's TWO-layer authorization in
 * the mandated order: first {@link requireScope} (the token-level capability-class gate —
 * a `work:read` token can never reach a `work:write` mutation), then {@link resolveActor}
 * (which proves org membership and yields the actor id every {@link authorize} call needs).
 * Every tool resolves its actor through here, so no mutation can skip the scope check.
 *
 * @param ctx - The authenticated caller (carrying verified scopes).
 * @param orgId - The organization the call targets.
 * @param required - The scope this tool requires (mcp-surface.md §3.2).
 * @returns the caller's resolved {@link McpActor}.
 * @throws {InsufficientScopeError} When the token lacks `required`.
 * @throws {NotFoundError} When the caller has no actor in the org.
 */
export async function scopedActor(
  ctx: McpContext,
  orgId: string,
  required: McpScope,
): Promise<McpActor> {
  requireScope(ctx.scopes, required);
  return resolveActor(ctx, orgId);
}

/**
 * Authorize an actor for a capability on a target, or throw the mapped API error.
 *
 * @remarks
 * The single choke point through which every MCP read and write passes — it NEVER
 * bypasses {@link canActor}. On denial it reproduces the RPC layer's 404-vs-403
 * decision: no effective capability (or below `view`) hides the resource with a
 * {@link NotFoundError}; a present-but-insufficient capability is a
 * {@link CapabilityError}.
 *
 * @param actor - The caller's resolved {@link McpActor} (org + actor id).
 * @param required - The capability the operation needs.
 * @param target - The resource being acted on.
 * @throws {NotFoundError} When the actor lacks any viewing capability (existence-hiding).
 * @throws {CapabilityError} When the actor can view but not perform the operation.
 */
export async function authorize(
  actor: McpActor,
  required: Capability,
  target: ResourceRef,
): Promise<void> {
  const result = await canActor(actor.actorId, required, target, db);
  if (result.allow) return;
  if (result.effectiveCapability === null) throw new NotFoundError();
  throw new CapabilityError();
}
