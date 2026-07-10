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
 * A social provider the sign-in / connect screens can offer.
 *
 * @remarks
 * A superset of {@link IdentityProvider}: it adds `apple`, which is a **sign-in-only** provider
 * (it links no connector identity, so it is not an `IdentityProvider`) but must still be reported
 * so the sign-in page can render its button. `discord` is here too (it is both a linkable identity
 * and, in principle, a sign-in provider). Mirrors `@docket/auth`'s `configuredSocialProviders`.
 */
export const SignInProvider = z
  .enum([...IdentityProvider.options, 'apple'])
  .describe('A social provider the sign-in/connect UI can offer (the identities plus `apple`).');
/** Sign-in-provider value. */
export type SignInProvider = z.infer<typeof SignInProvider>;

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
    appMode: z
      .enum(['local', 'test', 'production'])
      .describe(
        'The deployment mode the API is running in. `local` enables mock-everything affordances (stub OAuth, fixtures); `test` is the CI/test profile; `production` is the live deployment. The web client branches dev-only UI on this.',
      )
      .meta({ example: 'production' }),
    /** The social providers whose OAuth credentials are configured server-side. */
    oauthProviders: z
      .array(SignInProvider)
      .describe(
        'The social providers a user can sign in with / link an identity from, derived from real server credentials: a provider appears here iff its OAuth client id + secret are configured. The sign-in page renders exactly these buttons. One of `google` | `github` | `linear` | `discord` | `apple` (apple is sign-in only, not a linkable identity).',
      )
      .meta({ example: ['google', 'github'] }),
    /** Whether Google sign-in/linking is open beyond the production test-user allowlist. */
    googleOAuthPublic: z
      .boolean()
      .optional()
      .describe('False while Google OAuth is staged for designated test users only.'),
    /** The connector keys unlocked by the configured providers (e.g. `gtasks`, `github`). */
    connectors: z
      .array(z.string())
      .describe(
        'The connector keys unlocked by the configured providers — the data sources an org can sync. A configured Google grant unlocks `drive`/`gmail`/`calendar`/`gtasks`; GitHub unlocks `github`; Linear unlocks `linear`. Empty when no providers are configured.',
      )
      .meta({ example: ['drive', 'gmail', 'calendar', 'gtasks', 'github'] }),
    /** The MCP server URL, or null when not configured. */
    mcpUrl: z
      .string()
      .nullable()
      .describe(
        'The Model Context Protocol server URL to show in the Authorized-apps setup guide, or null when `MCP_RESOURCE_URL` is unset (the client then derives it from its own origin). Absolute URL when present.',
      )
      .meta({ example: 'https://api.docket.example/mcp' }),
  })
  .meta({
    id: 'PublicConfigOut',
    description: "The web client's runtime configuration, derived from real server credentials.",
  });
/** Public client-config value. */
export type PublicConfigOut = z.infer<typeof PublicConfigOut>;
