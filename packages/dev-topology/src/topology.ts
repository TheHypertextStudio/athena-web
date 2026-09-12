/**
 * The complete env a checkout's dev stack runs on, derived rather than transcribed.
 */
import type { CheckoutIdentity } from './checkout';
import { deriveWebPort, hostPrefix, PORT_STRIDE } from './checkout';
import { DEV_DOMAIN } from './hosts';

/** The four ports a checkout's services bind, in the order the stride assigns them. */
export interface PortBlock {
  readonly web: number;
  readonly api: number;
  readonly admin: number;
  readonly runner: number;
}

/** Everything downstream needs to address this checkout. */
export interface DevTopology {
  /** Hostname prefix, ending in `.`, or empty on the primary checkout. */
  readonly prefix: string;
  readonly ports: PortBlock;
  readonly appUrl: string;
  readonly apiUrl: string;
  readonly adminUrl: string;
  readonly runnerUrl: string;
  /** The env assignments that put a process on this topology. */
  readonly env: Readonly<Record<string, string>>;
}

/** Split a derived base port into the block its services bind. */
export function portBlock(base: number): PortBlock {
  return { web: base, api: base + 1, admin: base + 2, runner: base + 3 };
}

/** How many ports a single checkout reserves. */
export const PORTS_PER_CHECKOUT = PORT_STRIDE;

/**
 * Build the explicit-port topology for a checkout.
 *
 * @param identity - The checkout to describe.
 * @param base - Override the derived base port, for a caller that probed and moved on from a
 *   block another checkout already holds.
 *
 * @remarks
 * This mode addresses each process directly over HTTP and does not involve Portless. It is what
 * automated verification uses, because a proxy that can drop routes is not a boundary an
 * acceptance run can depend on.
 */
export function explicitPortTopology(identity: CheckoutIdentity, base?: number): DevTopology {
  const prefix = hostPrefix(identity);
  const ports = portBlock(base ?? deriveWebPort(identity));

  const appUrl = `http://${prefix}${DEV_DOMAIN}:${ports.web}`;
  const apiUrl = `http://${prefix}api.${DEV_DOMAIN}:${ports.api}`;
  const adminUrl = `http://${prefix}admin.${DEV_DOMAIN}:${ports.admin}`;
  const runnerUrl = `http://127.0.0.1:${ports.runner}`;

  return {
    prefix,
    ports,
    appUrl,
    apiUrl,
    adminUrl,
    runnerUrl,
    env: {
      APP_URL: appUrl,
      WEB_URL: appUrl,
      API_URL: apiUrl,
      ADMIN_URL: adminUrl,
      NEXT_PUBLIC_API_URL: apiUrl,
      NEXT_PUBLIC_APP_URL: appUrl,
      BETTER_AUTH_URL: apiUrl,
      // The relying-party id must be a registrable suffix of every origin in the stack, and the
      // prefixed app and api hosts are siblings, so the shared parent is the only valid value.
      BETTER_AUTH_PASSKEY_RP_ID: DEV_DOMAIN,
      NEXT_PUBLIC_PASSKEY_RP_ID: DEV_DOMAIN,
      BETTER_AUTH_TRUSTED_ORIGINS: `${appUrl},${adminUrl}`,
      BETTER_AUTH_ALLOWED_HOSTS: [
        `${prefix}${DEV_DOMAIN}:${ports.web}`,
        `${prefix}admin.${DEV_DOMAIN}:${ports.admin}`,
        `${prefix}api.${DEV_DOMAIN}:${ports.api}`,
      ].join(','),
      MCP_ISSUER_URL: apiUrl,
      MCP_RESOURCE_URL: `${apiUrl}/mcp`,
      MCP_ALLOWED_ORIGINS: appUrl,
      OIDC_LOGIN_PAGE_URL: `${appUrl}/sign-in`,
      CLOUDFLARE_ATHENA_RUNNER_URL: runnerUrl,
      GOOGLE_OAUTH_PUBLIC: 'false',
      // The API is the only process whose validated runtime contract consumes PORT.
      PORT: String(ports.api),
      DOCKET_WEB_PORT: String(ports.web),
      DOCKET_API_PORT: String(ports.api),
      DOCKET_ADMIN_PORT: String(ports.admin),
      DOCKET_RUNNER_PORT: String(ports.runner),
    },
  };
}

/** Render a topology's env as `export NAME="value"` lines for a shell to `eval`. */
export function shellExports(env: Readonly<Record<string, string>>): string {
  return Object.entries(env)
    .map(([name, value]) => `export ${name}="${value}"`)
    .join('\n');
}
