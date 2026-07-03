/**
 * `pnpm bootstrap` helper — cloudflared named-tunnel config, persistence, and registration URLs.
 *
 * @remarks
 * Pure string builders (no I/O) consumed by `bootstrap.ts`'s dev-tunnel step. A persistent tunnel
 * gives the local stack a public, Google-acceptable URL (`*.localhost` is rejected) for real OAuth
 * and inbound webhooks.
 *
 * Ingress is SPLIT by path:
 *
 * - `/(api|v1|internal)/*` → **straight to the local API port** (`http://127.0.0.1:<apiPort>`), preserving the
 *   public `Host`. This is load-bearing for OAuth: portless rewrites the upstream `Host` to its
 *   loopback address (the real host survives only in `X-Forwarded-Host`), and Next's rewrite then
 *   re-derives its own forwarded host from that loopback — so going through portless makes Better
 *   Auth resolve its base (and the OAuth token-exchange `redirect_uri`) to a `.localhost` host
 *   instead of the tunnel host Google saw at authorize time → `invalid_grant` → `invalid_code`.
 *   Routing the API directly keeps `Host = <tunnel hostname>` intact end-to-end so the exchange
 *   `redirect_uri` matches. (`apiPort` is portless's stable per-name port for `api.docket`.)
 * - everything else → the portless WEB host (`https://docket.localhost`) with `noTLSVerify` (portless
 *   serves a local-CA cert cloudflared may not trust) + `httpHostHeader` so portless still routes by
 *   name. This serves the Next app; its pages are host-agnostic.
 *
 * Persistence is a **user LaunchAgent**, not `cloudflared service install`: the root daemon can't
 * read the user's `~/.cloudflared` config (and recent versions install a non-functional plist),
 * whereas a LaunchAgent runs as the user, reads the user config, and needs no sudo.
 */

/** The portless web host the tunnel fronts; its Next proxy reaches the API. */
const ORIGIN_HOST = 'docket.localhost';

/** A named cloudflared tunnel fronting the local stack at a public hostname. */
export interface TunnelConfig {
  /** The cloudflared tunnel name (e.g. `docket-dev`). */
  readonly tunnel: string;
  /** The public hostname on the team Cloudflare zone (e.g. `docket-dev.hypertext.studio`). */
  readonly hostname: string;
  /** Absolute path to the tunnel's credentials JSON (`~/.cloudflared/<id>.json`). */
  readonly credentialsFile: string;
  /** The local port the Hono API listens on (portless's stable per-name port for `api.docket`). */
  readonly apiPort: number;
}

/** The `~/.cloudflared/config.yml` that fronts the local portless stack at `hostname`. */
export function cloudflaredConfigYaml({
  tunnel,
  hostname,
  credentialsFile,
  apiPort,
}: TunnelConfig): string {
  return [
    `tunnel: ${tunnel}`,
    `credentials-file: ${credentialsFile}`,
    `ingress:`,
    `  # API + auth callbacks + webhooks (/internal/ingest, /internal/integrations, cron):`,
    `  # straight to the API, Host preserved (see module docstring).`,
    `  - hostname: ${hostname}`,
    `    path: ^/(api|v1|internal)/.*`,
    `    service: http://127.0.0.1:${String(apiPort)}`,
    `  # Everything else: the Next web app via portless (routes by name, local-CA cert).`,
    `  - hostname: ${hostname}`,
    `    service: https://${ORIGIN_HOST}`,
    `    originRequest:`,
    `      noTLSVerify: true`,
    `      httpHostHeader: ${ORIGIN_HOST}`,
    `  - service: http_status:404`,
    ``,
  ].join('\n');
}

/** Inputs for the persistence LaunchAgent. */
export interface LaunchAgentInput {
  /** The launchd label (reverse-DNS); also the plist filename stem. */
  readonly label: string;
  /** Absolute path to the `cloudflared` binary (`which cloudflared`). */
  readonly cloudflaredBin: string;
  /** Absolute path to the tunnel config written by {@link cloudflaredConfigYaml}. */
  readonly configPath: string;
  /** The tunnel name to run. */
  readonly tunnel: string;
  /** Absolute path for the agent's combined stdout/stderr log. */
  readonly logPath: string;
}

/** A user LaunchAgent plist that runs `cloudflared tunnel run` at login (persistent, no sudo). */
export function launchAgentPlist({
  label,
  cloudflaredBin,
  configPath,
  tunnel,
  logPath,
}: LaunchAgentInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${cloudflaredBin}</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>${configPath}</string>
    <string>run</string>
    <string>${tunnel}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

/** The OAuth callback + provider webhook URLs to register once the tunnel `hostname` is live. */
export function tunnelRegistrationUrls(hostname: string): {
  googleRedirectUri: string;
  googleOrigin: string;
  githubWebhook: string;
  slackRedirectUri: string;
  slackEventsUrl: string;
} {
  const origin = `https://${hostname}`;
  return {
    googleRedirectUri: `${origin}/api/auth/callback/google`,
    googleOrigin: origin,
    githubWebhook: `${origin}/internal/ingest/github`,
    slackRedirectUri: `${origin}/internal/integrations/slack/callback`,
    slackEventsUrl: `${origin}/internal/ingest/slack`,
  };
}
