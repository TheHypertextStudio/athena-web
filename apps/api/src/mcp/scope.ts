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

/** The complete, ordered Docket MCP capability scope set. */
export const MCP_SCOPES: readonly McpScope[] = [
  'work:read',
  'work:write',
  'agents:run',
  'connectors:link',
] as const;

/**
 * The OAuth scope that makes the Authorization Server mint a refresh token.
 *
 * @remarks
 * Deliberately NOT an {@link McpScope}: it gates nothing on the resource server, so it must
 * never be assignable into {@link TOOL_SCOPE}, {@link RESOURCE_READ_SCOPE}, or
 * {@link requireScope}. It matters here only because `oauthProvider()` issues a refresh token
 * *only* when the granted set contains it — a client that consents without it gets a
 * 15-minute connection and no renewal path.
 */
export const OFFLINE_ACCESS_SCOPE = 'offline_access';

/**
 * Everything a connecting client is asked to consent to, in one screen: the four capability
 * scopes plus `offline_access` (mcp-surface.md §2.3/§2.6).
 *
 * @remarks
 * Advertised in the PRM `scopes_supported`, in both `WWW-Authenticate` challenges, and — via
 * `oauthProvider({ scopes })` — in the AS metadata document. Those four sources describe the
 * same authorization request and must not disagree: a client that intersects them would drop
 * whatever one of them omits, which is precisely how a connector ends up read-only or
 * non-renewable.
 */
export const CONNECT_SCOPES: readonly string[] = [...MCP_SCOPES, OFFLINE_ACCESS_SCOPE] as const;

/**
 * The scope each MCP tool requires (mcp-surface.md §3.2 quick-reference table).
 *
 * @remarks
 * Read tools (`list_work`/`find`) need only `work:read`; mutations need `work:write`;
 * agent-lifecycle tools need `agents:run`; connector tools need `connectors:link`. Keyed
 * by the registered tool name so {@link requireScope} can be called uniformly.
 */
export const TOOL_SCOPE: Readonly<Record<string, McpScope>> = {
  // work:write — work-layer mutations
  comment: 'work:write',
  report_status: 'work:write',
  capture: 'work:write',
  update: 'work:write',
  organize: 'work:write',
  link: 'work:write',
  archive: 'work:write',
  plan_day: 'work:write',
  undo: 'work:write',
  // connectors:link — external linking
  link_external: 'connectors:link',
  // agents:run — agent session lifecycle
  run_agent: 'agents:run',
  manage_session: 'agents:run',
  // work:read — reads exposed as tools
  list_work: 'work:read',
  find: 'work:read',
  get: 'work:read',
  brief: 'work:read',
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
 * Authorization Server and run the connect→discover→consent flow, and advertises the full
 * {@link CONNECT_SCOPES} set so the client asks for everything Docket offers in ONE consent
 * screen rather than connecting read-only and discovering later that it cannot write.
 *
 * Advertising `offline_access` here stretches RFC 6750 §3, which defines the `scope`
 * attribute as the scope *required* to access the resource — `offline_access` is not. It is
 * included deliberately: this challenge is the only signal Docket controls that reaches an
 * MCP client BEFORE it builds its authorize URL, and a client that omits `offline_access`
 * gets no refresh token, so its connection dies 15 minutes later with no recovery short of a
 * manual reconnect. A slightly over-broad hint is much cheaper than that.
 *
 * @param resourceMetadataUrl - The absolute PRM URL (`/.well-known/oauth-protected-resource/mcp`).
 * @returns the full `Bearer …` challenge value.
 */
export function challenge401(resourceMetadataUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${CONNECT_SCOPES.join(' ')}"`;
}

/**
 * Build the §2.6 403 `insufficient_scope` step-up challenge for a runtime scope failure.
 *
 * @remarks
 * Uses the spec's "recommended approach": the `scope` parameter lists the already-granted
 * scopes PLUS the newly-required one, deduped and stably ordered, so the client can
 * step-up authorize for the union in one round-trip.
 *
 * Filters {@link CONNECT_SCOPES}, not {@link MCP_SCOPES}, so that `offline_access` is carried
 * forward when — and only when — the token already holds it. Do not "simplify" this back to
 * `MCP_SCOPES`: dropping it would make the stepped-up token non-renewable, silently trading a
 * durable connection for a 15-minute one every time a client escalates.
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
  const needed = CONNECT_SCOPES.filter((s) => s === required || granted.includes(s));
  return [
    'Bearer error="insufficient_scope"',
    `scope="${needed.join(' ')}"`,
    `resource_metadata="${resourceMetadataUrl}"`,
    `error_description="This operation requires the '${required}' scope"`,
  ].join(', ');
}
