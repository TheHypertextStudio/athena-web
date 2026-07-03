/**
 * `scripts/integration-providers.ts` — the provider catalog for `pnpm integrations`.
 *
 * @remarks
 * The per-provider setup copy + metadata ({@link PROVIDER_GROUPS}) and the few helpers it needs,
 * split out of `integrations-setup.ts` so the orchestration there stays readable. This module is
 * pure data + formatting; `integrations-setup.ts` drives the prompts, cloud writes, and ordering.
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

// ── environments ────────────────────────────────────────────────────────────────

export type Environment = 'local' | 'staging' | 'production';

/**
 * Fallback local API origin (Better Auth base) when `.env.local` has none — matches the
 * project's portless convention (`https://api.docket.localhost`), NOT a bare `localhost:port`.
 */
export const DEFAULT_LOCAL_API_URL = 'https://api.docket.localhost';

// ── turnkey secret generation (no hand-run openssl) ──────────────────────────────

/** A fresh 48-hex-char secret (24 random bytes) — the GitHub webhook signing secret. */
function generateHexSecret(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Best-effort copy to the OS clipboard (pbcopy / xclip / wl-copy / clip).
 *
 * @returns true if a clipboard utility accepted the text.
 */
export function copyToClipboard(text: string): boolean {
  for (const cmd of ['pbcopy', 'xclip -selection clipboard', 'wl-copy', 'clip']) {
    try {
      execSync(cmd, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return true;
    } catch {
      // try the next utility
    }
  }
  return false;
}

// ── provider groups (curated order + DX copy; metadata comes from the registry) ──

/**
 * The two distinct origins a provider's setup URLs hang off — they are NOT the same host:
 *
 * - `webBases` — the browser-facing product origin(s) (web + admin). OAuth `redirect_uri`s and the
 *   GitHub connect callback live here, because the browser does the OAuth dance same-origin on the
 *   product domain (each Next app proxies `/api/auth` to the API) and the session cookie must be
 *   first-party there. A provider that allows several callback URLs registers one per entry.
 * - `apiBase` — the public API origin. Only genuinely server-to-server edges live here: provider
 *   webhooks (Stripe, the GitHub firehose) that the provider's *servers* POST to directly.
 */
export interface SetupUrls {
  readonly apiBase: string;
  readonly webBases: readonly string[];
}

export interface ProviderGroup {
  readonly title: string;
  /** Registry var names to prompt for, in order. */
  readonly vars: readonly string[];
  /** Explicit, copy-pasteable setup instructions for the chosen environment (shown all at once). */
  readonly instructions?: (env: Environment, urls: SetupUrls) => readonly string[];
  /**
   * A step-by-step alternative to {@link instructions}: each step shows a short, natural-language
   * instruction and then (optionally) prompts for the single value that step produces. Guidance
   * therefore always sits right next to the field it is for — no wall of text up front with every
   * value demanded at the end. Used by the GitHub App, whose console has many sequential steps.
   */
  readonly steps?: (
    env: Environment,
    urls: SetupUrls,
  ) => readonly { readonly note: readonly string[]; readonly var?: string }[];
  /**
   * Turnkey secrets generated FOR the user (not prompted): the returned values are shown +
   * copied to the clipboard, saved like any collected var, and skipped in the prompt loop.
   * Used for self-chosen secrets (e.g. the GitHub webhook secret) so nobody hand-runs openssl.
   */
  readonly generate?: (env: Environment) => Record<string, string>;
  /**
   * Per-var input transforms applied to what the user enters BEFORE it is stored — so a prompt can
   * accept a friendly form and the script does the mechanical conversion (turnkey). Keyed by var
   * name. Example: the GitHub App private key is entered as a `.pem` path (or pasted PEM) and
   * encoded to the single-line base64 the env contract expects.
   */
  readonly transform?: Readonly<Record<string, (raw: string) => string>>;
}

/**
 * Turn a GitHub App private key the user provides — a path to the downloaded `.pem`, or pasted PEM
 * text — into the single-line base64 the env contract stores. An already-base64 value passes
 * through unchanged (so re-runs are idempotent), making the prompt fully turnkey.
 *
 * @param raw - What the user typed: a file path, PEM text, or an existing base64 value.
 * @returns the base64-encoded PEM (or the input unchanged when it is already base64).
 */
function encodePrivateKeyInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Pasted PEM text → encode the original bytes as-is.
  if (trimmed.includes('-----BEGIN')) return Buffer.from(raw, 'utf8').toString('base64');
  // Otherwise treat it as a path to the downloaded .pem and read it.
  try {
    const path = trimmed.startsWith('~/')
      ? resolve(process.env['HOME'] ?? '', trimmed.slice(2))
      : trimmed;
    const fromFile = readFileSync(path, 'utf8');
    if (!fromFile.includes('-----BEGIN')) return trimmed; // not a key file → assume already base64
    return Buffer.from(fromFile, 'utf8').toString('base64');
  } catch {
    return trimmed; // not a readable path and not PEM → assume the value is already base64
  }
}

/** Suggested OAuth-app name so each environment gets its own clearly-labelled app. */
function appName(env: Environment): string {
  return `Docket (${env})`;
}

export const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  {
    title: 'Google Integration Set-up',
    vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    instructions: (env, urls) => [
      'Creates an OAuth 2.0 Web-application client. ~5 min. You need a Google account.',
      '',
      '1) Open https://console.cloud.google.com/ and sign in.',
      '2) Top bar → project picker → "New Project" → Name: "Docket" → Create, then make sure',
      '   that project is selected in the picker.',
      '3) Enable the APIs you need: ☰ menu → "APIs & Services" → "Library". Search each, open it,',
      '   click "Enable":',
      '     • "Google People API"   (required — sign-in profile)',
      '     • "Google Drive API", "Gmail API", "Google Calendar API", "Google Tasks API"',
      '       (only the connectors you plan to use)',
      '4) Configure the consent screen (first time only): "APIs & Services" → "OAuth consent screen".',
      '     • User type: "External" (or "Internal" if this is a Google Workspace org) → Create',
      '     • App name: "Docket", User support email: you, Developer contact email: you → Save',
      '     • Scopes: add ".../auth/userinfo.email", ".../auth/userinfo.profile", "openid"',
      '       (+ drive/gmail/calendar/tasks scopes if you enabled those APIs) → Save',
      '     • If the app is in "Testing", add your Google address under "Test users".',
      '5) Create the credential: "APIs & Services" → "Credentials" → "+ Create credentials" →',
      '   "OAuth client ID" → Application type: "Web application" →',
      `   Name: "${appName(env)}".`,
      '6) Under "Authorized redirect URIs" click "+ Add URI" and add one per Docket frontend',
      '   (the callback is browser-facing — it lives on the product origin, not the API), exactly,',
      '   no trailing slash:',
      ...urls.webBases.map((web) => `     ${web}/api/auth/callback/google`),
      '7) Click "Create". A dialog shows "Your Client ID" and "Your Client Secret".',
      '8) Copy both now (you can re-open them later from the Credentials list) and paste below.',
    ],
  },
  {
    title: 'GitHub Integration Set-up',
    vars: [
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_WEBHOOK_SECRET',
    ],
    steps: (env, urls) => {
      // Homepage + the OAuth/connect callbacks are browser-facing (product origin); only the
      // webhook is the API origin (GitHub's servers POST it directly).
      const homepage = urls.webBases[0] ?? urls.apiBase;
      return [
        {
          note: [
            'GitHub is one GitHub App that does three jobs at once: sign-in, the issue and',
            'pull-request connector, and the real-time webhook firehose. We will create it together,',
            'one field at a time, and paste back the values it gives you.',
            '',
            'Setting up locally? This is optional — local dev runs against a built-in mock, so you',
            'can press Enter past these prompts to skip and wire up GitHub later.',
            '',
            'Otherwise, open the New GitHub App page and click "New GitHub App":',
            '',
            '  https://github.com/organizations/<your-org>/settings/apps',
            '',
            "(Can't find it? Organization settings → Developer settings → GitHub Apps.) Leave that",
            'tab open — the next steps walk straight down the form.',
          ],
        },
        {
          note: [
            'Up top, give it a name and a homepage.',
            '',
            '  • GitHub App name: Docket  (or "Docket (your-org)" if that name is taken)',
            `  • Homepage URL:    ${homepage}`,
          ],
        },
        {
          note: [
            'Find the "Identifying and authorizing users" section — this is how sign-in and',
            'connecting an account return the user to Docket. These are browser-facing, so they go',
            'on the product origin(s), not the API host.',
            '',
            'In "Callback URL", add these (click "Add callback URL" for each — a GitHub App allows',
            'several): a sign-in + a connect callback for every Docket frontend:',
            '',
            ...urls.webBases.flatMap((web) => [
              `  • ${web}/api/auth/callback/github`,
              `  • ${web}/internal/integrations/github/callback`,
            ]),
            '',
            "(It's one app for every environment. In prod, oAuthProxy means you register ONLY the",
            'production callbacks and previews proxy through them — see the env-and-bootstrap spec.)',
            '',
            'Then tick all three checkboxes:',
            '',
            '  • "Expire user authorization tokens"  (gives Docket a refresh token)',
            '  • "Request user authorization (OAuth) during installation"',
            '  • "Redirect on update"',
            '',
            'Leave the "Setup URL" field alone — GitHub greys it out once you tick the',
            'OAuth-during-install box, which is what we want.',
          ],
        },
        {
          note:
            env === 'local'
              ? [
                  'Webhook — skip it for local dev. Local runs against a built-in mock, so just',
                  'leave "Active" unchecked and move on.',
                  '',
                  '(When you deploy to production you will set the Webhook URL once, to your public',
                  'API at https://your-api-host/internal/ingest/github, and turn it on. We have already',
                  'generated GITHUB_APP_WEBHOOK_SECRET and saved it for that day.)',
                ]
              : [
                  'Now the "Webhook" section — this is what makes the firehose real-time. Unlike the',
                  "callbacks above, this is server-to-server (GitHub's servers POST it), so it points",
                  'at the public API host.',
                  '',
                  '  • Tick "Active".',
                  `  • Webhook URL:  ${urls.apiBase}/internal/ingest/github`,
                  '  • Secret: paste the webhook secret we generated a moment ago (already on your',
                  '    clipboard, so just paste).',
                  '  • Leave "Enable SSL verification" on.',
                ],
        },
        {
          note: [
            'Scroll to "Repository permissions". Docket only reads — keep it least-privilege:',
            '',
            '  • Issues:         Read-only',
            '  • Pull requests:  Read-only',
            '',
            '(GitHub flips "Metadata" to Read-only for you automatically once you set those.)',
            '',
            'Then open "Account permissions" just below and set:',
            '',
            "  • Email addresses:  Read-only   (so sign-in can read the user's email)",
          ],
        },
        {
          note: [
            'Right under the permissions is "Subscribe to events". Heads up: these checkboxes only',
            'appear after you have set the repository permissions above, so do that first if the',
            'list looks empty.',
            '',
            'Check these four:',
            '',
            '  • Issues',
            '  • Issue comment',
            '  • Pull request',
            '  • Pull request review comment',
          ],
        },
        {
          note: [
            'Almost done with the form. At the very bottom, under "Where can this GitHub App be',
            'installed?", choose "Only on this account".',
            '',
            'Now click the big green "Create GitHub App" button. GitHub drops you on the app\'s',
            'General settings tab, which is where we grab the rest of the values.',
          ],
        },
        {
          note: [
            "You're on the app's General tab now. Near the top, under the \"About\" heading, you'll",
            'see "App ID:" followed by a number (for example, 4176808).',
            '',
            'Copy that number and paste it here.',
          ],
          var: 'GITHUB_APP_ID',
        },
        {
          note: [
            "Next we need the app's URL slug — the short name in its public URL.",
            '',
            'In the left sidebar click "Public page". The address bar will read',
            'github.com/apps/SOMETHING — that SOMETHING (e.g. "docket-by-project-athena") is the',
            'slug. Copy just that last part and paste it here, then come back to the General tab.',
          ],
          var: 'GITHUB_APP_SLUG',
        },
        {
          note: [
            'Back on the General tab under "About", right below the App ID, there is a',
            '"Client ID:" that starts with "Iv" (for example, Iv23liaJucynJMw2pdf3).',
            '',
            'Copy it and paste it here.',
          ],
          var: 'GITHUB_APP_CLIENT_ID',
        },
        {
          note: [
            'Still on the General tab, scroll down to the "Client secrets" section and click',
            '"Generate a new client secret". GitHub shows the secret once and warns you that you',
            'will not be able to see it again — so copy it right away and paste it here.',
          ],
          var: 'GITHUB_APP_CLIENT_SECRET',
        },
        {
          note: [
            'Last one — the private key.',
            '',
            'Keep scrolling the General tab to the "Private keys" section and click "Generate a',
            'private key". GitHub immediately downloads a .pem file to your computer (it never',
            'shows the contents on screen), so note where it lands — usually your Downloads folder.',
            '',
            'Then drag that .pem file straight into this terminal, or type/paste its path, and',
            'press Enter. No need to convert anything — Docket base64-encodes it for you.',
          ],
          var: 'GITHUB_APP_PRIVATE_KEY',
        },
      ];
    },
    // Self-chosen secret — generate it for the user instead of making them run openssl.
    generate: () => ({ GITHUB_APP_WEBHOOK_SECRET: generateHexSecret() }),
    // Turnkey: the user gives the downloaded .pem path (or pastes the PEM); we base64-encode it.
    transform: { GITHUB_APP_PRIVATE_KEY: encodePrivateKeyInput },
  },
  {
    title: 'Linear Integration Set-up',
    vars: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
    instructions: (env, urls) => [
      'Creates a Linear OAuth2 application. ~2 min. You need a Linear workspace admin.',
      '',
      '1) Open https://linear.app/settings/api/applications/new',
      '   (or: Linear → workspace menu (top-left) → Settings → "API" → "OAuth applications" →',
      '   "Create new").',
      `2) Application name: "${appName(env)}". Add a developer name + icon if it asks.`,
      '3) Callback URLs — browser-facing, so add one per Docket frontend, exactly, no trailing slash:',
      ...urls.webBases.map((web) => `     ${web}/api/auth/oauth2/callback/linear`),
      '4) Scopes: tick "read" (required for sign-in). For the issue-migration feature also tick',
      '   "write" and "issues:create".',
      '5) Keep the app private (untick "Public") unless you intend multi-workspace installs → "Create".',
      '6) Copy the "Client ID" and "Client secret" shown, and paste below.',
    ],
  },
  {
    title: 'Slack Integration Set-up',
    vars: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'],
    instructions: (env, urls) => [
      'Creates the shared Slack app (user-token Events API). ~5 min. You need a Slack account;',
      'the app is created once and then installed per-user via "Connect Slack" in Docket.',
      '',
      'Setting up locally? This is optional — local dev runs against a built-in mock (the connect',
      'flow short-circuits to fixtures), so you can press Enter past these prompts and wire up',
      'Slack later. A real local webhook loop also needs the cloudflared tunnel (`pnpm bootstrap`)',
      'and a SEPARATE dev Slack app — Slack allows one events request URL per app.',
      '',
      '1) Open https://api.slack.com/apps and click "Create New App" → "From a manifest".',
      '2) Pick any workspace you own to host the app (end users install it into their own).',
      '3) Paste the manifest from infra/slack/docket-app-manifest.yaml, substituting:',
      `     • oauth redirect url  : ${urls.apiBase}/internal/integrations/slack/callback`,
      `     • events request_url  : ${urls.apiBase}/internal/ingest/slack`,
      '   → Create. (Slack verifies the request URL live, so the API must already be deployed',
      '   and reachable at that host — deploy first, then create/update the app.)',
      env === 'production'
        ? '4) Under "Manage Distribution", activate public distribution so any workspace can install it.'
        : '4) Distribution can stay off for a dev app (you install it into your own workspace).',
      '5) Open "Basic Information" → "App Credentials" and copy, then paste below:',
      '     • Client ID     → SLACK_CLIENT_ID',
      '     • Client Secret → SLACK_CLIENT_SECRET',
      '     • Signing Secret→ SLACK_SIGNING_SECRET',
    ],
  },
  {
    title: 'Stripe Integration Set-up',
    vars: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
    instructions: (env, urls) => {
      const mode = env === 'production' ? 'live' : 'test';
      const lines = [
        `Use ${mode}-mode keys for the "${env}" environment. Never mix test and live across envs.`,
        '',
        '1) Open https://dashboard.stripe.com and sign in.',
        `2) Top-right toggle: switch to ${mode} mode (the "Test mode" switch must show "${mode}").`,
        '3) API keys: Developers → API keys (https://dashboard.stripe.com/apikeys).',
        `     • Copy "Secret key"      → starts with ${env === 'production' ? 'sk_live_' : 'sk_test_'}`,
        `     • Copy "Publishable key" → starts with ${env === 'production' ? 'pk_live_' : 'pk_test_'}`,
        '4) Webhook signing secret (whsec_…):',
      ];
      if (env === 'local') {
        lines.push(
          '     • Install the Stripe CLI (https://stripe.com/docs/stripe-cli), then in a SEPARATE',
          '       terminal run:',
          '           stripe login',
          `           stripe listen --forward-to ${urls.apiBase}/api/auth/stripe/webhook`,
          '     • It prints "Ready! ... whsec_…" — copy that whsec_ value.',
          '     • Keep that terminal running while developing so webhooks reach your local API.',
        );
      } else {
        lines.push(
          '     • Developers → Webhooks → "Add endpoint".',
          `     • Endpoint URL (paste exactly): ${urls.apiBase}/api/auth/stripe/webhook`,
          '     • "Select events" → add: checkout.session.completed, customer.subscription.created,',
          '       customer.subscription.updated, customer.subscription.deleted, invoice.paid,',
          '       invoice.payment_failed → "Add endpoint".',
          '     • Open the new endpoint → "Signing secret" → "Reveal" → copy the whsec_… value.',
        );
      }
      lines.push(
        '',
        'Note: plan prices (DOCKET_PRICE_LOOKUP_*) are created separately via the Stripe CLI/',
        'dashboard and are not collected here. Leave all three blank to keep billing on the mock.',
      );
      return lines;
    },
  },
  {
    title: 'Anthropic Integration Set-up (optional)',
    vars: ['ANTHROPIC_API_KEY'],
    instructions: (env) => [
      'Powers real Athena/Claude turns. Optional — blank keeps the deterministic mock runtime',
      '(local/test always use the mock regardless of this key).',
      '',
      '1) Open https://console.anthropic.com and sign in.',
      '2) Ensure the workspace has billing/credits (Settings → Billing).',
      '3) Settings → "API keys" → "Create Key".',
      `4) Name it "${appName(env)}" → Create → copy the key (starts with sk-ant-…, shown once).`,
      '5) Paste below, or leave blank to skip.',
    ],
  },
  {
    title: 'Email Integration Set-up (optional)',
    vars: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'],
    instructions: (env) =>
      env === 'local'
        ? [
            'Local dev uses Mailpit — a fake SMTP server with a web inbox. Blank SMTP_HOST keeps the',
            'no-op mock mailer (emails are just logged).',
            '',
            '1) Start Mailpit (pick one):',
            '     • Docker:  docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit',
            '     • Homebrew: brew install mailpit && mailpit',
            '2) Enter at the prompts below:',
            '     • SMTP_HOST = localhost',
            '     • SMTP_PORT = 1025',
            '     • SMTP_USER / SMTP_PASS = leave blank (Mailpit needs no auth)',
            '     • MAIL_FROM = "Docket <dev@docket.localhost>"',
            '3) View captured email at http://localhost:8025.',
          ]
        : [
            'Use a transactional email provider (Resend, Postmark, Amazon SES, Mailgun, …). Blank',
            'SMTP_HOST keeps the no-op mock mailer.',
            '',
            '1) In your provider, create SMTP credentials and verify a sending domain/address.',
            '2) Enter at the prompts below:',
            '     • SMTP_HOST = the provider host (e.g. smtp.resend.com)',
            '     • SMTP_PORT = 465 (implicit TLS) or 587 (STARTTLS) per the provider',
            '     • SMTP_USER / SMTP_PASS = the provider SMTP username + password/API key',
            '     • MAIL_FROM = a VERIFIED sender, e.g. "Docket <no-reply@your-domain.com>"',
          ],
  },
  {
    title: 'Observability & Storage Set-up (optional)',
    vars: ['SENTRY_DSN', 'BLOB_READ_WRITE_TOKEN', 'EXPORT_BUCKET_URL', 'EXPORT_BUCKET_TOKEN'],
    instructions: () => [
      'All optional. Leave blank to disable each.',
      '',
      'Sentry (error reporting):',
      '  1) https://sentry.io → create/select a project (platform: Node).',
      '  2) Settings → "Client Keys (DSN)" → copy the DSN (https://…@…ingest.sentry.io/…).',
      '',
      'Export storage (only if you use data-export artifacts — provide URL + token together):',
      '  • BLOB_READ_WRITE_TOKEN: Vercel → Storage → Blob → "Read/Write Token".',
      '  • EXPORT_BUCKET_URL + EXPORT_BUCKET_TOKEN: your S3-compatible bucket endpoint + access token.',
    ],
  },
];
