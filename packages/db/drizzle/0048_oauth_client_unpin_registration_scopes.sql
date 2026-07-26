-- Un-pin dynamically-registered MCP clients whose scope ceiling was frozen at registration.
--
-- `oauthProvider()` writes `oauth_client.scopes` from `clientRegistrationDefaultScopes` when a
-- client registers without an explicit `scope` — which every MCP client does. That row is then
-- the hard ceiling for BOTH `/oauth2/authorize` and the token exchange, so a client pinned to
-- {work:read, offline_access} can never step up to work:write: the authorize request is
-- rejected with `invalid_scope` before the consent screen is reached, and a refresh grant can
-- only ever narrow. Removing the narrower default (packages/auth/src/auth-builder.ts) stops new
-- rows from being pinned; this repairs rows already written.
--
-- NULL rather than the full scope list, on purpose: NULL makes the plugin fall through to its
-- configured `scopes` (`client.scopes ?? opts.scopes`), which is already how CIMD-registered
-- clients behave (apps/api/src/mcp/cimd.ts deliberately omits `scopes` on upsert). A hardcoded
-- array would re-freeze these rows against any future scope addition — the same bug again.
--
-- `<@` ("is contained by") matches only rows whose scopes are a subset of the pinned default,
-- so a client that ever deliberately registered narrow is left alone.
--
-- Deliberately does NOT touch `oauth_consent` or `oauth_refresh_token`: those record what the
-- user actually approved. Widening them would forge consent and mint capabilities nobody
-- granted. Users re-authorize through the consent screen instead.
--
-- Idempotent: matched rows end with `scopes IS NULL` and are excluded from any re-run. A no-op
-- against an `oauth_client` table that migration 0047 just created empty.
UPDATE "oauth_client"
SET "scopes" = NULL,
    "updated_at" = now()
WHERE "scopes" IS NOT NULL
  AND "scopes" <@ ARRAY['work:read', 'offline_access']::text[];
