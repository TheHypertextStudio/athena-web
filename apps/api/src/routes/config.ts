/**
 * `@docket/api` — public client-config router (mounted at `/v1/config`).
 *
 * @remarks
 * The single source the web app reads its runtime configuration from, so the client never mirrors
 * server setup into parallel `NEXT_PUBLIC_*` flags. Availability is **derived from the real server
 * credentials**: a provider is offered iff its OAuth client id + secret are configured (the same
 * truth {@link configuredSocialProviders} feeds into Better Auth), and a connector is offered iff
 * the grant that funds it is configured. Public (no session) — it carries nothing secret, and the
 * sign-in page needs it before anyone is authenticated.
 */
import { configuredSocialProviders, type SocialProvider } from '@docket/auth';
import { PublicConfigOut } from '@docket/types';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { env } from '../env';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

/**
 * The connector keys each configured social provider unlocks.
 *
 * @remarks
 * One Google grant funds every Google product connector; GitHub/Linear fund their own. Mirrors the
 * connector → social mapping (`socialProviderId`) in the other direction.
 */
const CONNECTORS_BY_PROVIDER: Record<SocialProvider, readonly string[]> = {
  google: ['drive', 'gmail', 'calendar', 'gtasks'],
  github: ['github'],
  linear: ['linear'],
};

const config = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Config',
    summary: 'Get public client config',
    response: PublicConfigOut,
    description: `Return the non-secret runtime configuration the web client bootstraps from. This is the **single public, unauthenticated endpoint** in the personal/account domain — it explicitly opts out of the global bearer requirement (\`security: []\`) because the sign-in page reads it *before* anyone is authenticated, to decide which auth buttons and connector affordances to render.

The payload is **derived from the server's real credentials**, never from a parallel set of \`NEXT_PUBLIC_*\` mirror flags: a social provider is listed in \`oauthProviders\` if and only if its OAuth client id + secret are actually configured (the same truth Better Auth's \`configuredSocialProviders\` consumes), and a connector key is listed in \`connectors\` only when the grant that funds it is configured (one Google grant unlocks \`drive\`/\`gmail\`/\`calendar\`/\`gtasks\`; GitHub and Linear fund their own). Because availability is computed from setup, the advertised capabilities can never drift from what the server can actually do. \`appMode\` echoes the deployment mode (\`local\` flips on mock-everything affordances) and \`mcpUrl\` is the MCP server URL shown in the Authorized-apps setup guide (null when unset — the client then derives it from its own origin).

Carries nothing secret and requires no session. Related: the authenticated personal surfaces (\`/v1/me/*\`, \`/v1/hub/*\`, \`/v1/notifications\`, \`/v1/daily-plan\`) all assume the client already learned provider/connector availability from here.`,
    extra: { security: [] },
  }),
  (c) => {
    const oauthProviders = configuredSocialProviders(env);
    const connectors = oauthProviders.flatMap((p) => CONNECTORS_BY_PROVIDER[p]);
    return ok(c, PublicConfigOut, {
      appMode: env.APP_MODE,
      oauthProviders,
      connectors: [...connectors],
      mcpUrl: env.MCP_RESOURCE_URL ?? null,
    });
  },
);

export default config;
