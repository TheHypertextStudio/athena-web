'use client';

/**
 * `lib/public-config` — the single client-side configuration boundary.
 *
 * @remarks
 * The web app reads its runtime feature configuration from `GET /v1/config` (see
 * `@docket/api` `routes/config.ts`) instead of mirroring server setup into a parallel set of
 * build-time `NEXT_PUBLIC_*` flags. Availability is **derived from the real server credentials**:
 * a provider/connector is offered iff its credentials are actually configured. No component reads
 * `process.env` to decide what to show — they call {@link usePublicConfig} and the typed helpers
 * here — so the client can never drift from real setup (no `NEXT_PUBLIC_OAUTH_GOOGLE`-style flag
 * to forget). Required deployment URLs that must exist before any fetch (the auth base URL, the
 * passkey RP ID) are not feature config and stay in their dedicated resolvers.
 */
import type { PublicConfigOut } from '@docket/types';
import type { UseQueryResult } from '@tanstack/react-query';

import {
  REDIRECT_CONNECT_PROVIDERS,
  socialProviderForConnector,
} from '@/components/settings/integrations-config';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/**
 * Fetch the deployment's public configuration (`GET /v1/config`).
 *
 * @remarks
 * Cached as static-ish (it only changes when the server is redeployed). Every UI surface that
 * needs to know what is configured — OAuth buttons, connector cards, the MCP setup guide —
 * reads from this single query rather than the environment.
 *
 * @returns the TanStack Query result whose `data` is the {@link PublicConfigOut}.
 */
export function usePublicConfig(): UseQueryResult<PublicConfigOut> {
  return useApiQuery(
    apiQueryOptions(
      queryKeys.publicConfig(),
      () => api.v1.config.$get(),
      'Could not load configuration.',
      {
        staleTime: STALE.static,
      },
    ),
  );
}

/**
 * Whether this deployment runs against the mock boundary adapters (local dev), in which case
 * every provider is connectable without real OAuth.
 *
 * @param config - The fetched config, or undefined while loading.
 */
export function isMockMode(config: PublicConfigOut | undefined): boolean {
  return config?.appMode === 'local';
}

/**
 * Whether the social grant funding a connector is configured server-side.
 *
 * @param config - The fetched config, or undefined while loading.
 * @param provider - The connector provider (e.g. `gtasks`, `github`).
 */
export function connectorOAuthConfigured(
  config: PublicConfigOut | undefined,
  provider: string,
): boolean {
  // Redirect-connect providers (Slack) have their own app credentials, not a social grant —
  // the server advertises them directly in `connectors` when configured.
  if (REDIRECT_CONNECT_PROVIDERS.has(provider)) {
    return config?.connectors.includes(provider) ?? false;
  }
  const social = socialProviderForConnector(provider);
  return config?.oauthProviders.includes(social) ?? false;
}

/**
 * Whether a connector can actually be set up in this deployment.
 *
 * @remarks
 * Available when the local mock backs every provider, or when the connector's grant is configured.
 * Without that, connecting would only ever produce a broken `needs_reauth`/`error` row, so the UI
 * must show it as "Available soon" (never claim a connector works when nothing is set up).
 *
 * @param config - The fetched config, or undefined while loading.
 * @param provider - The connector provider key.
 */
export function connectorAvailable(config: PublicConfigOut | undefined, provider: string): boolean {
  return isMockMode(config) || connectorOAuthConfigured(config, provider);
}

/**
 * The MCP server URL to show in the Authorized-apps setup guide.
 *
 * @remarks
 * Prefers the server-configured URL; when absent, derives a same-deployment URL from the current
 * window origin (so a local dev without an explicit MCP URL still shows something usable).
 *
 * @param config - The fetched config, or undefined while loading.
 */
export function mcpUrl(config: PublicConfigOut | undefined): string {
  if (config?.mcpUrl) return config.mcpUrl;
  const origin =
    typeof window !== 'undefined' ? window.location.origin.replace('app.', 'api.') : '';
  return `${origin}/mcp`;
}
