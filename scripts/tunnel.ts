/**
 * `pnpm bootstrap` helper — cloudflared named-tunnel config + one-time setup steps.
 *
 * @remarks
 * Pure string builders (no I/O) consumed by `bootstrap.ts`'s dev-tunnel step. A persistent tunnel
 * is wanted for two things: the **shared OAuth anchor** (a team host registered with Google once,
 * that every dev's local OAuth proxies through) and a **personal tunnel** (exposing a dev's local
 * stack for webhooks/demos).
 *
 * The tunnel fronts the portless WEB host (`https://docket.localhost`), whose Next rewrites already
 * proxy `/api/auth` + `/v1` to the API — so one ingress covers OAuth callbacks AND the GitHub
 * firehose. Dev ports are ephemeral under portless, so the origin is the STABLE portless host with
 * `noTLSVerify` (portless serves a local-CA cert cloudflared may not trust) + `httpHostHeader` so
 * portless still routes by name. The browser's host flows through as `X-Forwarded-Host`, which
 * Better Auth's dynamic base resolver honours once the host is in `BETTER_AUTH_ALLOWED_HOSTS`.
 */

/** The portless web host the tunnel fronts; its Next proxy reaches the API. */
const ORIGIN_HOST = 'docket.localhost';

/** A named cloudflared tunnel fronting the local stack at a public hostname. */
export interface TunnelConfig {
  /** The cloudflared tunnel name (e.g. `docket-dev`). */
  readonly tunnel: string;
  /** The public hostname on the team Cloudflare zone (e.g. `dev.usedocket.app`). */
  readonly hostname: string;
}

/** The `~/.cloudflared/config.yml` that fronts the local portless stack at `hostname`. */
export function cloudflaredConfigYaml({ tunnel, hostname }: TunnelConfig): string {
  return [
    `tunnel: ${tunnel}`,
    `ingress:`,
    `  - hostname: ${hostname}`,
    `    service: https://${ORIGIN_HOST}`,
    `    originRequest:`,
    `      noTLSVerify: true`,
    `      httpHostHeader: ${ORIGIN_HOST}`,
    `  - service: http_status:404`,
    ``,
  ].join('\n');
}

/**
 * The one-time commands to stand up the persistent named tunnel as a boot service.
 *
 * @remarks
 * `login` and `create` are interactive (browser auth on the team zone), so these are printed for
 * the operator to run — not executed blindly. `service install` makes the tunnel persistent across
 * reboots (mirrors `pnpm proxy:install` for portless); `tunnel run` is the foreground alternative.
 */
export function cloudflaredSetupSteps({ tunnel, hostname }: TunnelConfig): string[] {
  return [
    `cloudflared tunnel login`,
    `cloudflared tunnel create ${tunnel}`,
    `cloudflared tunnel route dns ${tunnel} ${hostname}`,
    `# write the config above to ~/.cloudflared/config.yml, then make it persistent:`,
    `sudo cloudflared service install     # runs the tunnel at boot`,
    `# …or run it in the foreground instead:  cloudflared tunnel run ${tunnel}`,
  ];
}

/** The OAuth callback + GitHub-firehose URLs to register once the tunnel `hostname` is live. */
export function tunnelRegistrationUrls(hostname: string): {
  googleRedirectUri: string;
  googleOrigin: string;
  githubWebhook: string;
} {
  const origin = `https://${hostname}`;
  return {
    googleRedirectUri: `${origin}/api/auth/callback/google`,
    googleOrigin: origin,
    githubWebhook: `${origin}/v1/ingest/github`,
  };
}
