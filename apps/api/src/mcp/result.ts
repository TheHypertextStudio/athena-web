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
import type { McpActor } from './auth';

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
