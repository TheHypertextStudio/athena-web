/**
 * `@docket/api` — the MCP OAuth scope layer (mcp-surface.md §2.2/§2.6/§3.2).
 *
 * @remarks
 * This is the FIRST of the two mandatory authorization layers on the MCP surface. The
 * access token carries a flat, global set of the four Docket scopes
 * (`work:read`/`work:write`/`agents:run`/`connectors:link`). Each tool/resource declares
 * the scope its operation requires; {@link requireScope} verifies the token carries it
 * BEFORE the per-org {@link import('@docket/authz').canActor} grant check runs.
 *
 * Scope is **necessary but not sufficient** (§2.2): a token with `work:write` still hits
 * the grant gate, and a token without `work:write` can never mutate even if the Actor
 * holds `contribute`. A missing scope throws {@link InsufficientScopeError}, which the
 * tool/result layer surfaces as `isError:true` (so the model self-corrects) and the HTTP
 * handler surfaces as a 403 `insufficient_scope` step-up challenge (§2.6) — the exact path
 * by which a read-only agent escalates to write.
 */
import { InsufficientScopeError } from '../error';

/** One of the four flat, global Docket MCP scopes (mcp-surface.md §2.2). */
export type McpScope = 'work:read' | 'work:write' | 'agents:run' | 'connectors:link';

/** The complete, ordered Docket MCP scope set (advertised in PRM `scopes_supported`). */
export const MCP_SCOPES: readonly McpScope[] = [
  'work:read',
  'work:write',
  'agents:run',
  'connectors:link',
] as const;

/**
 * The scope each MCP tool requires (mcp-surface.md §3.2 quick-reference table).
 *
 * @remarks
 * Read tools (`run_view`/`search`) need only `work:read`; mutations need `work:write`;
 * agent-lifecycle tools need `agents:run`; connector tools need `connectors:link`. Keyed
 * by the registered tool name so {@link requireScope} can be called uniformly.
 */
export const TOOL_SCOPE: Readonly<Record<string, McpScope>> = {
  // work:write — work-layer mutations
  create_task: 'work:write',
  update_task: 'work:write',
  move_task: 'work:write',
  assign_task: 'work:write',
  set_task_delegate: 'work:write',
  set_task_state: 'work:write',
  add_subtask: 'work:write',
  add_task_dependency: 'work:write',
  remove_task_dependency: 'work:write',
  create_project: 'work:write',
  update_project: 'work:write',
  create_program: 'work:write',
  create_initiative: 'work:write',
  update_initiative: 'work:write',
  link_initiative: 'work:write',
  add_comment: 'work:write',
  post_update: 'work:write',
  add_to_daily_plan: 'work:write',
  pause_athena_assignment_trigger: 'work:write',
  remove_athena_assignment_trigger: 'work:write',
  // connectors:link — external linking
  link_external: 'connectors:link',
  // agents:run — agent session lifecycle
  trigger_agent: 'agents:run',
  respond_to_session: 'agents:run',
  approve_action: 'agents:run',
  reject_action: 'agents:run',
  cancel_session: 'agents:run',
  // work:read — reads exposed as tools
  run_view: 'work:read',
  search: 'work:read',
} as const;

/** The scope every `docket://` resource read requires (all reads are `work:read`). */
export const RESOURCE_READ_SCOPE: McpScope = 'work:read';

/**
 * Assert the caller's token carries `required`, or throw {@link InsufficientScopeError}.
 *
 * @remarks
 * The scope gate that runs BEFORE every grant check. `scopes` is the verified token's
 * scope set ({@link import('./auth').McpContext.scopes}). When the token was resolved
 * from a first-party cookie session (no OAuth scopes), {@link import('./auth').McpContext}
 * carries the full scope set, so this is a no-op for them — the grant layer still gates.
 *
 * @param scopes - The verified scopes on the caller's token.
 * @param required - The scope the operation needs.
 * @throws {InsufficientScopeError} When `required` is not present in `scopes`.
 */
export function requireScope(scopes: readonly string[], required: McpScope): void {
  if (!scopes.includes(required)) throw new InsufficientScopeError(required);
}

/**
 * Build the §2.6 401 `WWW-Authenticate` challenge (no/invalid token).
 *
 * @remarks
 * Points the client at the Protected Resource Metadata document so it can discover the
 * Authorization Server and run the connect→discover→consent flow, and advertises the
 * baseline `work:read` scope.
 *
 * @param resourceMetadataUrl - The absolute PRM URL (`/.well-known/oauth-protected-resource/mcp`).
 * @returns the full `Bearer …` challenge value.
 */
export function challenge401(resourceMetadataUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl}", scope="work:read"`;
}

/**
 * Build the §2.6 403 `insufficient_scope` step-up challenge for a runtime scope failure.
 *
 * @remarks
 * Uses the spec's "recommended approach": the `scope` parameter lists the already-granted
 * scopes PLUS the newly-required one, deduped and stably ordered, so the client can
 * step-up authorize for the union in one round-trip.
 *
 * @param resourceMetadataUrl - The absolute PRM URL.
 * @param required - The scope the operation needs.
 * @param granted - The scopes the token already carries.
 * @returns the full `Bearer error="insufficient_scope" …` challenge value.
 */
export function challenge403(
  resourceMetadataUrl: string,
  required: McpScope,
  granted: readonly string[],
): string {
  const needed = MCP_SCOPES.filter((s) => s === required || granted.includes(s));
  return [
    'Bearer error="insufficient_scope"',
    `scope="${needed.join(' ')}"`,
    `resource_metadata="${resourceMetadataUrl}"`,
    `error_description="This operation requires the '${required}' scope"`,
  ].join(', ');
}
