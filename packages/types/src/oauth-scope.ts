/**
 * `@docket/types` — the closed set of OAuth scopes Docket's authorization server can issue.
 *
 * @remarks
 * This module exists because the scope list used to be written down three times: in
 * `packages/auth`'s `oauthProvider({ scopes })` (the hard ceiling the authorization server
 * enforces), in `apps/api/src/mcp/scope.ts` (`MCP_SCOPES`/`CONNECT_SCOPES`, advertised in the
 * Protected Resource Metadata document and both `WWW-Authenticate` challenges), and in the
 * consent screen's copy map. Those three describe one authorization request. When they disagree
 * a connecting client silently drops whichever scope the source it happened to read omitted —
 * which is how a connector ends up permanently read-only, or non-renewable, or asking a person
 * to approve a permission the screen has no words for.
 *
 * Everything downstream now derives from {@link OAUTH_ISSUABLE_SCOPES}, so the three cannot
 * drift. The consent copy map is additionally *typed* against {@link OAuthIssuableScope}, which
 * makes "a sixth scope was added with no plain-English description" a compile error rather than
 * a raw identifier rendered at a layperson.
 */

/**
 * The four capability scopes the Docket resource server enforces.
 *
 * @remarks
 * Deliberately excludes `offline_access`: that scope gates nothing on the resource server, so it
 * must never be assignable where a capability is required (see `apps/api/src/mcp/scope.ts`).
 */
export type McpCapabilityScope = 'work:read' | 'work:write' | 'agents:run' | 'connectors:link';

/**
 * The standard OAuth scope that makes the authorization server mint a refresh token.
 *
 * @remarks
 * Not a Docket capability. It is in the issuable set because `oauthProvider()` issues a refresh
 * token *only* when the granted set contains it — a client that consents without it gets a
 * 15-minute connection and no renewal path.
 */
export const OFFLINE_ACCESS_SCOPE = 'offline_access';

/**
 * The COMPLETE, closed set of scopes Docket's authorization server can ever issue, in
 * consent-screen order.
 *
 * @remarks
 * The single source of truth: `packages/auth`'s `oauthProvider({ scopes })`, the API's
 * `CONNECT_SCOPES`, and the consent screen's copy map all derive from this array, so they cannot
 * drift. Because `oauthProvider({ scopes })` is the authorization server's hard ceiling, a scope
 * absent from this array cannot be granted, cannot appear in a minted token, and therefore
 * cannot unlock anything — which is what lets the consent screen tell a reader, truthfully, that
 * approving an unrecognized request grants nothing.
 */
export const OAUTH_ISSUABLE_SCOPES: readonly [
  'work:read',
  'work:write',
  'agents:run',
  'connectors:link',
  'offline_access',
] = ['work:read', 'work:write', 'agents:run', 'connectors:link', 'offline_access'] as const;

/** One member of {@link OAUTH_ISSUABLE_SCOPES}. */
export type OAuthIssuableScope = (typeof OAUTH_ISSUABLE_SCOPES)[number];
