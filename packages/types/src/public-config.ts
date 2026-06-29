/**
 * `@docket/types` — the public, unauthenticated client-config DTO.
 *
 * @remarks
 * The web app reads its runtime configuration from `GET /v1/config` instead of mirroring server
 * setup into a parallel set of build-time `NEXT_PUBLIC_*` flags. Everything here is **derived from
 * the real server credentials** — a provider/connector is listed iff its credentials are actually
 * configured — so availability can never drift from setup (no `NEXT_PUBLIC_OAUTH_GOOGLE`-style
 * mirror flag to forget). Contains nothing secret: it is the same truth the sign-in page already
 * needs to decide which buttons to show.
 */
import { z } from 'zod';

import { IdentityProvider } from './identity';

/**
 * The public client configuration derived from the server's real environment.
 *
 * @remarks
 * `oauthProviders` are the social providers a user can link/sign in with (their OAuth client
 * id + secret are configured); `connectors` are the connector keys those grants unlock (e.g. a
 * configured Google grant unlocks `drive`/`gmail`/`calendar`/`gtasks`). `mcpUrl` is the MCP
 * server URL to show in the Authorized-apps setup guide, or null when not configured (the client
 * then derives it from its own origin).
 */
export const PublicConfigOut = z
  .object({
    /** The deployment mode — `local` enables the mock-everything affordances. */
    appMode: z.enum(['local', 'test', 'production']),
    /** The social providers whose OAuth credentials are configured server-side. */
    oauthProviders: z.array(IdentityProvider),
    /** The connector keys unlocked by the configured providers (e.g. `gtasks`, `github`). */
    connectors: z.array(z.string()),
    /** The MCP server URL, or null when not configured. */
    mcpUrl: z.string().nullable(),
  })
  .meta({
    id: 'PublicConfigOut',
    description: "The web client's runtime configuration, derived from real server credentials.",
  });
/** Public client-config value. */
export type PublicConfigOut = z.infer<typeof PublicConfigOut>;
