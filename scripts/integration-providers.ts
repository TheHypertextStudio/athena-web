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
  /** The selected cloud project, when the environment is hosted. */
  readonly projectId?: string;
}

/** Stable identifiers for every provider supported by the interactive setup wizard. */
export type ProviderId =
  | 'google'
  | 'github'
  | 'linear'
  | 'apple'
  | 'stripe'
  | 'anthropic'
  | 'email'
  | 'observability';

/** One operator-sized action in a provider's guided setup flow. */
export interface ProviderStep {
  readonly note: readonly string[];
  readonly var?: string;
  readonly openUrl?: string;
}

export interface ProviderGroup {
  /** Stable identifier used by status selection and CLI pre-scoping. */
  readonly id: ProviderId;
  readonly title: string;
  /** Short picker label. */
  readonly label: string;
  /** Provider setup is not required for Docket's core local/product flow. */
  readonly optional?: boolean;
  /** Primary provider page offered by the browser-assisted runner. */
  readonly consoleUrl?: string;
  /** Environment-aware provider form URL when deterministic fields can be prefilled. */
  readonly launchUrl?: (env: Environment, urls: SetupUrls) => string;
  /** Registry var names to prompt for, in order. */
  readonly vars: readonly string[];
  /** Values required for the provider's primary identity capability. */
  readonly requiredVars?: readonly string[];
  /** Docket-owned policy values shown separately from provider-console credentials. */
  readonly policyVars?: readonly string[];
  /** Optional connector/webhook values offered after the primary capability is configured. */
  readonly optionalVars?: readonly string[];
  /** Coherent optional capabilities; every variable in one group is required for that capability. */
  readonly optionalCapabilities?: readonly (readonly string[])[];
  /** Human-readable label for the optional capability. */
  readonly optionalLabel?: string;
  /** Environment-specific override for providers whose local and hosted transports differ. */
  readonly varsForEnvironment?: (env: Environment) => readonly string[];
  /** Non-secret cloud values that belong in GitHub environment variables, not Secret Manager. */
  readonly cloudVariables?: readonly string[];
  /** Explicit setup instructions for the chosen environment, split into progressive numbered steps. */
  readonly instructions?: (env: Environment, urls: SetupUrls) => readonly string[];
  /**
   * A step-by-step alternative to {@link instructions}: each step shows a short, natural-language
   * instruction and then (optionally) prompts for the single value that step produces. Guidance
   * therefore always sits right next to the field it is for — no wall of text up front with every
   * value demanded at the end. Used by the GitHub App, whose console has many sequential steps.
   */
  readonly steps?: (env: Environment, urls: SetupUrls) => readonly ProviderStep[];
  /** Additional guided steps for an optional connector/webhook capability. */
  readonly optionalSteps?: (env: Environment, urls: SetupUrls) => readonly ProviderStep[];
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
  /**
   * Optional multi-value credential import. The prompt accepts a downloaded provider file (or its
   * contents), validates it against this environment's URLs, and returns registry variables. A
   * blank response falls back to the normal per-variable prompts.
   */
  readonly credentialBundle?: {
    readonly message: string;
    readonly placeholder: string;
    readonly parse: (raw: string, urls: SetupUrls) => Record<string, string>;
  };
}

/** Resolve the variables a provider requires in the selected environment. */
export function providerVars(group: ProviderGroup, env: Environment): readonly string[] {
  return group.varsForEnvironment?.(env) ?? group.vars;
}

/**
 * Build Linear's supported pre-populated OAuth application creation URL.
 *
 * @remarks
 * Linear still requires an administrator to submit the form and copy the generated secrets, but
 * every deterministic field is encoded here: distribution, product identity, callback URLs, and
 * Issue/Comment webhook subscriptions.
 */
export function linearOAuthAppManifestUrl(env: Environment, urls: SetupUrls): string {
  const productUrl = urls.webBases[0] ?? urls.apiBase;
  const params = new URLSearchParams({
    distribution: env === 'production' ? 'public' : 'private',
    'display.description': 'Sync Linear issues into Docket as first-party tasks.',
    'developer.name': 'Hypertext Studio',
    'oauth.client_name': appName(env),
    'oauth.client_uri': productUrl,
    'webhook.enabled': 'true',
    'webhook.url': `${urls.apiBase}/internal/ingest/linear`,
  });
  for (const origin of new Set([...urls.webBases, urls.apiBase])) {
    params.append('oauth.redirect_uris', `${origin}/api/auth/callback/linear`);
  }
  params.append('oauth.grant_types', 'authorization_code');
  params.append('webhook.resourceTypes', 'Issue');
  params.append('webhook.resourceTypes', 'Comment');
  return `https://linear.app/settings/api/applications/new?${params.toString()}`;
}

interface GoogleOAuthWebClient {
  readonly client_id?: unknown;
  readonly client_secret?: unknown;
  readonly javascript_origins?: unknown;
  readonly redirect_uris?: unknown;
}

/** Normalize an OAuth origin/redirect URL for exact comparisons without a trailing slash. */
function normalizeOAuthUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Read a credential bundle from pasted JSON or a filesystem path, including `~/…` paths. */
function readCredentialBundle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const path = trimmed.startsWith('~/')
    ? resolve(process.env['HOME'] ?? '', trimmed.slice(2))
    : resolve(trimmed);
  return readFileSync(path, 'utf8');
}

/**
 * Parse Google's downloaded OAuth Web-client JSON and validate its Docket browser configuration.
 *
 * @remarks
 * Only the extracted registry values are returned. Error messages intentionally never include the
 * client id, client secret, or raw file contents.
 *
 * @param raw - Path to the downloaded JSON file, or the JSON contents.
 * @param urls - Expected Docket origins and browser-facing OAuth callbacks for this environment.
 * @returns Google client credentials ready for the existing secret writer.
 * @throws {Error} When the file is malformed, is not a Web client, or targets different URLs.
 */
export function parseGoogleOAuthClientBundle(
  raw: string,
  urls: SetupUrls,
): Record<'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET', string> {
  let document: unknown;
  try {
    document = JSON.parse(readCredentialBundle(raw));
  } catch {
    throw new Error('Could not read a valid Google OAuth client JSON file.');
  }

  if (!document || typeof document !== 'object' || !('web' in document)) {
    throw new Error('Google credential must be an OAuth Web application client.');
  }
  const web = (document as { readonly web?: GoogleOAuthWebClient }).web;
  if (!web || typeof web.client_id !== 'string' || typeof web.client_secret !== 'string') {
    throw new Error('Google OAuth Web client JSON is missing its client id or client secret.');
  }

  const actualOrigins = Array.isArray(web.javascript_origins)
    ? new Set(
        web.javascript_origins
          .filter((value): value is string => typeof value === 'string')
          .map(normalizeOAuthUrl),
      )
    : new Set<string>();
  const expectedOrigins = urls.webBases.map(normalizeOAuthUrl);
  const missingOrigins = expectedOrigins.filter((origin) => !actualOrigins.has(origin));
  if (missingOrigins.length > 0) {
    throw new Error(
      `Google OAuth client is missing authorized origin: ${missingOrigins.join(', ')}`,
    );
  }

  const actualRedirects = Array.isArray(web.redirect_uris)
    ? new Set(
        web.redirect_uris
          .filter((value): value is string => typeof value === 'string')
          .map(normalizeOAuthUrl),
      )
    : new Set<string>();
  const expectedRedirects = expectedOrigins.map((origin) => `${origin}/api/auth/callback/google`);
  const missingRedirects = expectedRedirects.filter((redirect) => !actualRedirects.has(redirect));
  if (missingRedirects.length > 0) {
    throw new Error(
      `Google OAuth client is missing authorized redirect URI: ${missingRedirects.join(', ')}`,
    );
  }

  return {
    GOOGLE_CLIENT_ID: web.client_id,
    GOOGLE_CLIENT_SECRET: web.client_secret,
  };
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

/**
 * Turn what the user provides for Apple's Sign-in key — a path to the downloaded `.p8`, or pasted
 * PEM text — into the single-line, `\n`-escaped form `APPLE_PRIVATE_KEY` stores. Unlike GitHub's
 * key (base64), Apple's is stored with literal `\n` escapes so `generateAppleClientSecret` can
 * un-escape and parse it directly. An already-escaped value passes through unchanged (idempotent).
 *
 * @param raw - What the user typed: a file path, PEM text, or an existing escaped value.
 * @returns the single-line, `\n`-escaped PEM (or the input unchanged when already escaped).
 */
function encodeApplePrivateKeyInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Pasted PEM text → escape its real newlines below.
  if (trimmed.includes('-----BEGIN')) return trimmed.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
  // Otherwise treat it as a path to the downloaded .p8 and read it.
  try {
    const path = trimmed.startsWith('~/')
      ? resolve(process.env['HOME'] ?? '', trimmed.slice(2))
      : trimmed;
    const fromFile = readFileSync(path, 'utf8');
    if (!fromFile.includes('-----BEGIN')) return trimmed; // not a key file → assume already escaped
    return fromFile.trim().replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
  } catch {
    return trimmed; // not a readable path and not PEM → assume already escaped
  }
}

const OBSERVABILITY_VARS = [
  'SENTRY_DSN',
  'BLOB_READ_WRITE_TOKEN',
  'EXPORT_BUCKET_URL',
  'EXPORT_BUCKET_TOKEN',
] as const;

export const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  {
    id: 'google',
    title: 'Google Integration Set-up',
    label: 'Google OAuth + Workspace',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    vars: [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_OAUTH_PUBLIC',
      'GOOGLE_OAUTH_TEST_EMAILS',
    ],
    requiredVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    policyVars: ['GOOGLE_OAUTH_PUBLIC', 'GOOGLE_OAUTH_TEST_EMAILS'],
    cloudVariables: ['GOOGLE_OAUTH_PUBLIC', 'GOOGLE_OAUTH_TEST_EMAILS'],
    credentialBundle: {
      message: 'Downloaded Google OAuth Web-client JSON (path, or blank for manual entry)',
      placeholder: '~/Downloads/client_secret_….json',
      parse: parseGoogleOAuthClientBundle,
    },
    instructions: (env, urls) => [
      'Creates an OAuth 2.0 Web-application client. ~5 min. You need a Google account.',
      '',
      '1) Open https://console.cloud.google.com/ and sign in.',
      `2) In the project picker, select "${urls.projectId ?? 'the target project shown in the Docket preflight summary'}".`,
      '   Do not create a second project when this environment already has one.',
      '3) Enable the APIs you need: ☰ menu → "APIs & Services" → "Library". Search each, open it,',
      '   click "Enable":',
      '     • "Google People API"   (required — sign-in profile)',
      '     • "Gmail API", "Google Calendar API", "Google Tasks API"',
      '       (only the connectors you plan to use)',
      '4) Configure the consent screen (first time only): "APIs & Services" → "OAuth consent screen".',
      '     • User type: "External" (or "Internal" if this is a Google Workspace org) → Create',
      '     • App name: "Docket", User support email: you, Developer contact email: you → Save',
      '     • Scopes: add ".../auth/userinfo.email", ".../auth/userinfo.profile", "openid"',
      '       (+ gmail/calendar/tasks scopes if you enabled those APIs) → Save',
      '     • If the app is in "Testing", add your Google address under "Test users".',
      '5) Create the credential: "APIs & Services" → "Credentials" → "+ Create credentials" →',
      '   "OAuth client ID" → Application type: "Web application" →',
      `   Name: "${appName(env)}".`,
      '6) Under "Authorized JavaScript origins" click "+ Add URI" and add one per Docket',
      '   frontend, exactly, with no trailing slash:',
      ...urls.webBases.map((web) => `     ${web}`),
      '7) Under "Authorized redirect URIs" click "+ Add URI" and add one per Docket frontend',
      '   (the callback is browser-facing — it lives on the product origin, not the API), exactly:',
      ...urls.webBases.map((web) => `     ${web}/api/auth/callback/google`),
      '8) Click "Create" and keep the result open.',
      '9) Docket access policy is configured separately after this console flow. Keep the',
      '   consent screen in Testing until Google verification is approved.',
    ],
  },
  {
    id: 'github',
    title: 'GitHub Integration Set-up',
    label: 'GitHub App',
    consoleUrl: 'https://github.com/settings/apps',
    vars: [
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_WEBHOOK_SECRET',
    ],
    requiredVars: ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'],
    optionalVars: [
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_WEBHOOK_SECRET',
    ],
    optionalLabel: 'GitHub connector and webhook firehose',
    steps: (env, urls) => {
      // Homepage + the OAuth/connect callbacks are browser-facing (product origin); only the
      // webhook is the API origin (GitHub's servers POST it directly).
      const homepage = urls.webBases[0] ?? urls.apiBase;
      return [
        {
          note: [
            'GitHub uses one GitHub App for Docket sign-in. The same app can later power the',
            'issue and pull-request connector plus its real-time webhook firehose; those optional',
            'settings are handled in a separate section after the app exists.',
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
            `For ${env}, use the ${appName(env)} app. In prod, oAuthProxy means you register ONLY`,
            'the production callbacks and previews proxy through them — see the env-and-bootstrap spec.',
            '',
            'Then select:',
            '',
            '  • "Request user authorization (OAuth) during installation"',
            '  • "Redirect on update" under the Post installation section',
            '',
            'After selecting OAuth-during-install, the Setup URL field may turn gray. That is',
            'expected; leave it unchanged.',
          ],
        },
        {
          note: [
            'Create the app now. At the bottom, under "Where can this GitHub App be installed?",',
            'choose "Only on this account", then click the big green "Create GitHub App" button.',
            '',
            "GitHub drops you on the app's General settings tab. The sign-in credentials come next;",
            'optional connector and webhook settings are handled separately after that.',
          ],
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
      ];
    },
    optionalSteps: (env, urls) => [
      {
        note: [
          'Now configure the optional GitHub connector in the app settings sidebar.',
          '',
          'Open "Permissions & events" in the sidebar. Docket only reads — keep it least-privilege:',
          '',
          '  • Repository permissions → Issues:         Read-only',
          '  • Repository permissions → Pull requests:  Read-only',
          '  • Account permissions → Email addresses:   Read-only',
          '',
          'GitHub turns Metadata to Read-only automatically when repository access is configured.',
        ],
      },
      {
        note: [
          'In the same "Permissions & events" section, enable only these webhook events:',
          '',
          '  • Issues',
          '  • Issue comment',
          '  • Pull request',
          '  • Pull request review comment',
          '',
          'The event checkboxes appear in this sidebar after the permissions are set.',
        ],
      },
      {
        note:
          env === 'local'
            ? [
                'Skip the webhook for local development. Leave "Active" unchecked; local Docket',
                'uses a built-in mock and does not need a public webhook target.',
              ]
            : [
                'Configure the optional webhook firehose:',
                '',
                '  • Tick "Active".',
                `  • Webhook URL:  ${urls.apiBase}/internal/ingest/github`,
                '  • Secret: use the generated value Docket copies for you below.',
                '  • Leave "Enable SSL verification" on.',
              ],
        var: 'GITHUB_APP_WEBHOOK_SECRET',
      },
      {
        note: [
          'Collect the remaining connector values from the app settings:',
          '',
          '  • General → About → App ID (the numeric value)',
          '  • Sidebar → Public page → the final segment of github.com/apps/<slug>',
          '  • General → Private keys → Generate a private key; provide the downloaded .pem path',
          '    or paste the PEM below. Docket base64-encodes it for storage.',
        ],
        var: 'GITHUB_APP_ID',
      },
      {
        note: ['Paste the short app URL slug from the Public page here, without github.com/apps/.'],
        var: 'GITHUB_APP_SLUG',
      },
      {
        note: [
          'Provide the generated private key .pem path or its pasted contents. Docket encodes it',
          'for storage and never prints the key.',
        ],
        var: 'GITHUB_APP_PRIVATE_KEY',
      },
    ],
    // Self-chosen secret — generate it for the user instead of making them run openssl.
    generate: () => ({ GITHUB_APP_WEBHOOK_SECRET: generateHexSecret() }),
    // Turnkey: the user gives the downloaded .pem path (or pastes the PEM); we base64-encode it.
    transform: { GITHUB_APP_PRIVATE_KEY: encodePrivateKeyInput },
  },
  {
    id: 'linear',
    title: 'Linear Integration Set-up',
    label: 'Linear OAuth',
    consoleUrl: 'https://linear.app/settings/api/applications/new',
    launchUrl: linearOAuthAppManifestUrl,
    vars: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_WEBHOOK_SECRET'],
    requiredVars: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
    optionalVars: ['LINEAR_WEBHOOK_SECRET'],
    optionalLabel: 'Linear webhook delivery',
    instructions: (env, urls) => [
      'Creates a Linear OAuth2 application. ~2 min. You need a Linear workspace admin.',
      '',
      '1) Open the prefilled Linear application form offered by this wizard.',
      '   (Or use Linear → workspace menu → Settings → API → OAuth applications.)',
      `2) Confirm the application name is "${appName(env)}" and review the prefilled fields.`,
      '3) Confirm each callback URL is present exactly as shown, without a trailing slash:',
      ...[...new Set([...urls.webBases, urls.apiBase])].map(
        (origin) => `     ${origin}/api/auth/callback/linear`,
      ),
      '4) OAuth settings:',
      '     • Keep the Authorization Code grant. It is the normal browser redirect used for Docket',
      '       sign-in and account linking.',
      '     • Turn Client credentials OFF — Docket does not use a server-only app-token grant.',
      '     • If Linear shows a requested-scope picker, select only read. If it does not, leave it',
      '       alone: Docket requests read during user authorization.',
      '5) Webhooks:',
      '     • Keep Webhooks ON and set the URL to:',
      `       ${urls.apiBase}/internal/ingest/linear`,
      '     • Select only Issues and Comments under data-change events. Leave the other data, app,',
      '       and OAuth-authorization events off.',
      '     • Linear shows a separate webhook signing secret on the application detail page.',
      `6) Set Public ${env === 'production' ? 'ON for production' : 'OFF for this non-production app'}, then create the app.`,
    ],
  },
  {
    id: 'apple',
    title: 'Sign in with Apple Integration Set-up (optional)',
    label: 'Sign in with Apple',
    optional: true,
    consoleUrl: 'https://developer.apple.com/account/resources/identifiers/list',
    vars: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'],
    instructions: (_env, urls) => [
      'Adds "Sign in with Apple" as a fourth sign-in option (web only). ~10 min. You need an Apple',
      'Developer Program membership ($99/yr). Optional — leave every field blank to skip; Docket',
      'runs fine without it, same as the other social providers.',
      '',
      'Apple rejects localhost/non-HTTPS redirect URIs, so — like Google — exercising this locally',
      'for real needs the cloudflared tunnel + oAuthProxy setup from `pnpm bootstrap` (Phase 1).',
      '',
      '1) Open https://developer.apple.com/account/resources/identifiers/list and sign in.',
      '2) Create an App ID (skip if Docket already has one): "+" → "App IDs" → "App" → choose a',
      '   Bundle ID → under "Capabilities" tick "Sign in with Apple" → Continue → Register.',
      '3) Create a Services ID: "+" → "Services IDs" → Description: "Docket" → Identifier, e.g.',
      '   "com.yourteam.docket" (this becomes APPLE_CLIENT_ID below) → Continue → Register.',
      '4) Open that Services ID → tick "Sign in with Apple" → "Configure":',
      '     • Primary App ID: the App ID from step 2.',
      '     • Domains and Subdomains: the bare domain of your web app (e.g. "app.docket.app").',
      '     • Return URLs — browser-facing, so one per Docket frontend, exactly, no trailing slash:',
      ...urls.webBases.map((web) => `         ${web}/api/auth/callback/apple`),
      '   → Save → Continue → Save on the Services ID itself.',
      '5) Copy the Services ID identifier from step 3 → that is APPLE_CLIENT_ID.',
      '6) Note your Team ID — top-right of the Apple Developer site (or Account → Membership), a',
      '   10-character code → that is APPLE_TEAM_ID.',
      '7) Create a signing key: left sidebar "Keys" → "+" → Key Name: "Docket Sign in with Apple" →',
      '   tick "Sign in with Apple" → "Configure" → select the App ID from step 2 → Save → Continue →',
      '   Register → "Download". Apple shows the .p8 file ONCE — save it now, it cannot be re-downloaded.',
      '8) Note the Key ID shown on that same page (10 characters) → that is APPLE_KEY_ID.',
      '',
    ],
    transform: { APPLE_PRIVATE_KEY: encodeApplePrivateKeyInput },
  },
  {
    id: 'stripe',
    title: 'Stripe Integration Set-up',
    label: 'Stripe Billing',
    consoleUrl: 'https://dashboard.stripe.com/apikeys',
    vars: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
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
    id: 'anthropic',
    title: 'Anthropic Integration Set-up (optional)',
    label: 'Anthropic',
    optional: true,
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    vars: ['ANTHROPIC_API_KEY'],
    instructions: (env) => [
      'Powers real Athena/Claude turns. Optional — blank keeps the deterministic mock runtime',
      '(local/test always use the mock regardless of this key).',
      '',
      '1) Open https://console.anthropic.com and sign in.',
      '2) Ensure the workspace has billing/credits (Settings → Billing).',
      '3) Settings → "API keys" → "Create Key".',
      `4) Name it "${appName(env)}" → Create. The key starts with sk-ant-… and is shown once.`,
    ],
  },
  {
    id: 'email',
    title: 'Email Integration Set-up',
    label: 'Transactional Email',
    vars: ['RESEND_API_KEY', 'MAIL_FROM'],
    varsForEnvironment: (env) =>
      env === 'local'
        ? ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']
        : ['RESEND_API_KEY', 'MAIL_FROM'],
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
            'Production sends transactional email through the native Resend HTTPS API.',
            'A verified sender is required; capture and SMTP transports are not used in production.',
            '',
            '1) In Resend, verify a sending domain and create a domain-restricted sending API key.',
            '2) Enter at the prompts below:',
            '     • RESEND_API_KEY = the restricted Resend sending key',
            '     • MAIL_FROM = a VERIFIED sender, e.g. "Docket <no-reply@your-domain.com>"',
          ],
  },
  {
    id: 'observability',
    title: 'Observability & Storage Set-up (optional)',
    label: 'Observability + Storage',
    optional: true,
    consoleUrl: 'https://sentry.io/settings/projects/',
    vars: OBSERVABILITY_VARS,
    requiredVars: [],
    optionalVars: OBSERVABILITY_VARS,
    optionalCapabilities: [
      ['SENTRY_DSN'],
      ['BLOB_READ_WRITE_TOKEN'],
      ['EXPORT_BUCKET_URL', 'EXPORT_BUCKET_TOKEN'],
    ],
    optionalLabel: 'observability and export storage credentials',
    instructions: () => [
      'All optional. Leave blank to disable each.',
      '',
      'Sentry (error reporting):',
      '  1) https://sentry.io → create/select a project (platform: Node).',
      '  2) Settings → "Client Keys (DSN)" → copy the DSN (https://…@…ingest.sentry.io/…).',
      '',
      'Export storage (only if you use data-export artifacts):',
      '  • Vercel Blob: provide BLOB_READ_WRITE_TOKEN; the store URL is derived automatically.',
      '  • Custom storage: provide EXPORT_BUCKET_URL + EXPORT_BUCKET_TOKEN together.',
    ],
  },
];
