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

const config = new Hono<AppEnv>().get('/', (c) => {
  const oauthProviders = configuredSocialProviders(env);
  const connectors = oauthProviders.flatMap((p) => CONNECTORS_BY_PROVIDER[p]);
  return ok(c, PublicConfigOut, {
    appMode: env.APP_MODE,
    oauthProviders,
    connectors: [...connectors],
    mcpUrl: env.MCP_RESOURCE_URL ?? null,
  });
});

export default config;
