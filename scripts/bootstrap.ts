/**
 * `pnpm bootstrap` — set up Docket for local development, and optionally provision production.
 *
 * @remarks
 * Dev-first flow:
 *   Phase 1 (always): check dev tools (openssl/docker) → write a local-only `.env.local`
 *     (its own freshly-generated dev secrets) → optionally walk through local integrations.
 *   Phase 2 (opt-in): provision production — gcloud/gh prereqs + account confirmation, GCP
 *     APIs/service account/WIF/Artifact Registry/Secret Manager, GitHub Actions vars + secrets,
 *     every production provider unless the operator explicitly passes `--skip-providers`.
 *
 * Production secrets are held in memory and pushed straight to Secret Manager / GitHub — never
 * written to disk. Idempotent — safe to re-run; existing resources are detected and skipped.
 * Cloud Run URLs are unknown until the first deploy; the script prints the follow-up commands.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { cancel, confirm, intro, log, note, outro, password, text } from '@clack/prompts';

import {
  chooseGcloudProject,
  buildApiSecretBindings,
  confirmAuthAccounts,
  detectRepo,
  exec,
  listGcloudAccounts,
  listGhAccounts,
  parseEnvFile,
  runIntegrationSetup,
  tryRun,
  unwrap,
  upsertEnvVars,
} from './integrations-setup';
import { cloudflaredConfigYaml, launchAgentPlist, tunnelRegistrationUrls } from './tunnel';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SA_NAME = 'docket-deploy';
const AR_REPO = 'docket';
const WIF_POOL = 'github';
const WIF_PROVIDER = 'github-actions';

/** Parsed phase controls accepted by `pnpm bootstrap -- <flags>`. */
export interface BootstrapFlags {
  readonly production: boolean;
  readonly skipLocal: boolean;
  readonly skipTunnel: boolean;
  readonly skipProduction: boolean;
  readonly skipInfrastructure: boolean;
  readonly skipProviders: boolean;
  readonly help: boolean;
}

/**
 * Parse explicit bootstrap phase flags, rejecting misspellings instead of silently ignoring them.
 *
 * @throws When a flag is unknown, mutually exclusive, or skips every bootstrap phase.
 */
export function parseBootstrapFlags(args: readonly string[]): BootstrapFlags {
  const known = new Set([
    '--',
    '--production',
    '--skip-local',
    '--skip-tunnel',
    '--skip-production',
    '--skip-infrastructure',
    '--skip-providers',
    '--help',
    '-h',
  ]);
  const normalized = args.filter((arg) => arg !== '--');
  const unknown = normalized.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown bootstrap flag(s): ${unknown.join(', ')}`);
  const flags: BootstrapFlags = {
    production: normalized.includes('--production'),
    skipLocal: normalized.includes('--skip-local'),
    skipTunnel: normalized.includes('--skip-tunnel'),
    skipProduction: normalized.includes('--skip-production'),
    skipInfrastructure: normalized.includes('--skip-infrastructure'),
    skipProviders: normalized.includes('--skip-providers'),
    help: normalized.includes('--help') || normalized.includes('-h'),
  };
  if (flags.production && flags.skipProduction) {
    throw new Error('--production and --skip-production cannot be used together');
  }
  if (flags.skipInfrastructure && flags.skipProduction) {
    throw new Error('--skip-infrastructure has no effect when production is skipped');
  }
  if (
    flags.skipLocal &&
    flags.production &&
    flags.skipInfrastructure &&
    flags.skipProviders &&
    !flags.help
  ) {
    throw new Error('The selected flags would skip all local, infrastructure, and provider work');
  }
  if (flags.skipLocal && flags.skipProduction && !flags.help) {
    throw new Error('--skip-local and --skip-production would skip every bootstrap phase');
  }
  return flags;
}

/** Render the bootstrap flags and the shortest production-provider invocation. */
function bootstrapHelp(): string {
  return [
    'Usage: pnpm bootstrap -- [flags]',
    '',
    '  --production       provision production without the opt-in prompt',
    '  --skip-local       skip local env and tunnel setup',
    '  --skip-tunnel      keep local env setup but skip the cloudflared tunnel',
    '  --skip-production  perform local setup only',
    '  --skip-infrastructure reuse existing GCP/GitHub foundation',
    '  --skip-providers   explicitly omit provider credential setup',
    '  --help, -h         show this help',
    '',
    'Fastest provider-only production setup (all providers):',
    '  pnpm bootstrap -- --skip-local --production --skip-infrastructure',
  ].join('\n');
}

// ── helpers ──────────────────────────────────────────────────────────────────

// execSync wrappers + env parsing + the clack-cancel `unwrap` are shared from
// ./integrations-setup; bootstrap keeps only `run` (throwing) and its clack log wrappers.
function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

// All output routes through @clack/prompts so the script reads as one consistent flow.

function ok(msg: string): void {
  log.success(msg);
}

function step(msg: string): void {
  log.step(msg);
}

function warn(msg: string): void {
  log.warn(msg);
}

function section(title: string): void {
  log.info(title);
}

/** Plain text prompt (clack); empty input resolves to `fallback`. `placeholder` is the grey hint. */
async function prompt(question: string, fallback = '', placeholder?: string): Promise<string> {
  const answer = unwrap(
    await text({
      message: question,
      defaultValue: fallback,
      placeholder: placeholder ?? fallback,
    }),
  );
  return answer.trim() || fallback;
}

/** Masked secret prompt (clack). */
async function promptSecret(question: string): Promise<string> {
  return unwrap(await password({ message: question })).trim();
}

// ── prerequisite checks ───────────────────────────────────────────────────────

/** First line of a CLI's version output, trimmed (e.g. "Google Cloud SDK 531.0.0"). */
function firstLine(cmd: string): string {
  return tryRun(cmd).split('\n')[0]?.trim() ?? '';
}

/** Verify the tools local dev needs (openssl required; docker only for the local Postgres). */
function checkDevPrereqs(): void {
  const openssl = firstLine('openssl version');
  const docker = firstLine('docker --version');
  note(
    [
      openssl ? `✓ openssl  ${openssl}` : '✗ openssl  not found — install: brew install openssl',
      docker
        ? `✓ docker   ${docker}`
        : '• docker   optional — needed for local Postgres (pnpm db:up); pglite works without it',
    ].join('\n'),
    openssl ? 'Checked: local dev prerequisites' : 'Missing: local dev prerequisites (openssl)',
  );
  if (!openssl) {
    cancel('Install openssl, then re-run pnpm bootstrap.');
    process.exit(1);
  }
}

/**
 * Ensure `cloudflared` is installed before the tunnel step — CHECK, and RESOLVE by installing it
 * via Homebrew (never assume the user already has it).
 *
 * @returns whether cloudflared is available after the check/install.
 */
async function ensureCloudflared(): Promise<boolean> {
  const found = firstLine('cloudflared --version');
  if (found) {
    ok(`cloudflared ${found}`);
    return true;
  }
  const brew = firstLine('brew --version');
  if (!brew) {
    warn(
      'cloudflared is not installed, and Homebrew is unavailable to install it. Install it manually:\n' +
        '  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    );
    return false;
  }
  const install = unwrap(
    await confirm({
      message: 'cloudflared is not installed. Install it now (brew install cloudflared)?',
      initialValue: true,
    }),
  );
  if (!install) {
    warn('Skipped — cloudflared is required for the tunnel.');
    return false;
  }
  try {
    exec('brew install cloudflared');
  } catch {
    warn('brew install cloudflared failed — install it manually and re-run.');
    return false;
  }
  const now = firstLine('cloudflared --version');
  if (now) {
    ok(`Installed cloudflared ${now}`);
    return true;
  }
  warn('cloudflared still not found after install — install it manually and re-run.');
  return false;
}

/** Verify gcloud + gh are installed AND authenticated — only needed when provisioning prod. */
function checkProdPrereqs(): void {
  const gcloud = firstLine('gcloud --version');
  const gh = firstLine('gh --version');
  note(
    [
      gcloud
        ? `✓ gcloud  ${gcloud}`
        : '✗ gcloud  not found — install: https://cloud.google.com/sdk',
      gh ? `✓ gh      ${gh}` : '✗ gh      not found — install: https://cli.github.com',
    ].join('\n'),
    gcloud && gh ? 'Checked: production tools' : 'Missing: production tools',
  );
  if (!gcloud || !gh) {
    cancel('Install the missing tool(s) above, then re-run and opt into production.');
    process.exit(1);
  }

  // Show WHICH accounts are authenticated (selection happens next, in confirmAuthAccounts).
  const gcloudAccounts = listGcloudAccounts();
  const ghAccounts = listGhAccounts();
  const gcloudActive = gcloudAccounts.find((a) => a.active)?.id ?? gcloudAccounts[0]?.id ?? '';
  const ghActive = ghAccounts.find((a) => a.active)?.id ?? ghAccounts[0]?.id ?? '';
  note(
    [
      gcloudAccounts.length > 0
        ? `✓ gcloud  ${gcloudAccounts.length} account(s), active: ${gcloudActive}`
        : '✗ gcloud  not authenticated — run: gcloud auth login',
      ghActive ? `✓ gh      ${ghActive}` : '✗ gh      not authenticated — run: gh auth login',
    ].join('\n'),
    'Checked: authenticated CLIs (you choose which to use next)',
  );
  if (gcloudAccounts.length === 0 || !ghActive) {
    cancel('Authenticate the tool(s) above, then re-run and opt into production.');
    process.exit(1);
  }
}

// ── gather config ─────────────────────────────────────────────────────────────

interface Config {
  project: string;
  projectNumber: string;
  region: string;
  repo: string; // owner/repo
  domain: string; // registrable domain for passkeys (e.g. example.com)
  webUrl: string; // e.g. https://docket.example.com
  apiUrl: string; // e.g. https://docket-api.example.com
  adminUrl: string; // e.g. https://docket-admin.example.com
  neonProjectId: string;
  neonApiKey: string | null; // null = already stored in GitHub; skip upload
  databaseUrl: string;
  databaseUrlUnpooled: string;
}

async function gatherConfig(): Promise<Config> {
  // Every value below is a production value — defaults are prod-shaped, never seeded from the
  // local .env.local (that would bleed dev values like *.localhost into prod). The account to
  // use was already confirmed by main() before this step.
  const project = await chooseGcloudProject(
    tryRun('gcloud config get-value project'),
    'the production deploy',
  );
  if (!project) {
    cancel('A GCP project is required.');
    process.exit(1);
  }
  const projectNumber = run(`gcloud projects describe ${project} --format='value(projectNumber)'`);

  const region = await prompt('Production GCP region', 'us-central1');

  const repo = await prompt('GitHub owner/repo to deploy from (CI)', detectRepo());

  const domain = await prompt(
    'Production apex domain shared by all prod hosts (passkey RP ID)',
    '',
    'docket.app',
  );
  if (!domain) {
    cancel('A production domain is required.');
    process.exit(1);
  }
  if (domain.endsWith('.localhost')) {
    warn(`"${domain}" looks like a local dev value — this is the production setup.`);
  }

  // Derive default prod URLs from the apex (e.g. docket.app → app/api/admin.docket.app).
  const webUrl = await prompt('Production web app URL', `https://app.${domain}`);
  const apiUrl = await prompt('Production API URL', `https://api.${domain}`);
  const adminUrl = await prompt('Production admin URL', `https://admin.${domain}`);

  log.info('Production database — Neon (neon.tech → New project → Connection details)');
  const neonProjectId = await prompt('Neon project ID', '', 'cool-darkness-12345678');

  // Skip the API key prompt if it's already stored as a GitHub secret.
  const neonKeyAlreadySet =
    !!repo &&
    tryRun(`gh secret list --repo ${repo} 2>/dev/null | grep -c '^NEON_API_KEY\b'`) === '1';
  let neonApiKey: string | null;
  if (neonKeyAlreadySet) {
    ok('NEON_API_KEY already in GitHub secrets — not re-prompting');
    neonApiKey = null;
  } else {
    neonApiKey = await promptSecret('Neon API key (neon.tech → Account → API keys)');
    if (!neonApiKey) {
      cancel('The Neon API key is required (CI uses it to create preview DB branches).');
      process.exit(1);
    }
  }
  const databaseUrl = await prompt(
    'Production Neon DATABASE_URL (pooled)',
    '',
    'postgres://…@…-pooler.neon.tech/docket?sslmode=require',
  );
  const databaseUrlUnpooled = await prompt(
    'Production Neon DATABASE_URL_UNPOOLED (direct, for migrations)',
    databaseUrl,
  );

  const cfg: Config = {
    project,
    projectNumber,
    region,
    repo,
    domain,
    webUrl,
    apiUrl,
    adminUrl,
    neonProjectId,
    neonApiKey,
    databaseUrl,
    databaseUrlUnpooled,
  };

  // Precise echo of exactly what will be provisioned — review before any cloud writes happen.
  note(
    [
      `GCP project   ${project} (#${projectNumber})`,
      `GCP region    ${region}`,
      `GitHub repo   ${repo}`,
      `Apex domain   ${domain}`,
      `Web / API     ${webUrl}  /  ${apiUrl}`,
      `Admin         ${adminUrl}`,
      `Neon project  ${neonProjectId || '(none)'}`,
      `Database      ${databaseUrl ? `${databaseUrl.slice(0, 32)}…` : '(none)'}`,
    ].join('\n'),
    'Production configuration to provision',
  );
  const proceed = unwrap(
    await confirm({ message: `Provision these production resources in ${project}?` }),
  );
  if (!proceed) {
    cancel('No changes made.');
    process.exit(0);
  }

  return cfg;
}

// ── gcp ───────────────────────────────────────────────────────────────────────

function setupGcp(cfg: Config): { saEmail: string; wifProvider: string } {
  section('GCP — APIs');

  const apis = [
    'run.googleapis.com',
    'artifactregistry.googleapis.com',
    'secretmanager.googleapis.com',
    'iam.googleapis.com',
    'iamcredentials.googleapis.com',
    'sts.googleapis.com', // required for WIF OIDC token exchange
    'cloudresourcemanager.googleapis.com',
    'cloudscheduler.googleapis.com', // drives the secret-guarded cron endpoints (pnpm scheduler:setup)
  ];
  step(`enabling ${apis.length} APIs (may take ~30s)…`);
  exec(`gcloud services enable ${apis.join(' ')} --project=${cfg.project}`);
  ok('APIs enabled');

  section('GCP — Service Account');

  const saEmail = `${SA_NAME}@${cfg.project}.iam.gserviceaccount.com`;
  const saExists = tryRun(
    `gcloud iam service-accounts describe ${saEmail} --project=${cfg.project} --format='value(email)'`,
  );
  if (saExists) {
    ok(`service account exists: ${saEmail}`);
  } else {
    exec(`gcloud iam service-accounts create ${SA_NAME} \
      --project=${cfg.project} \
      --display-name="Docket GitHub Deploy"`);
    ok(`created: ${saEmail}`);
  }

  const roles = [
    'roles/run.developer',
    'roles/artifactregistry.writer',
    'roles/secretmanager.secretAccessor',
    'roles/iam.serviceAccountUser',
    'roles/cloudscheduler.admin', // create/update the cron jobs from CI (pnpm scheduler:setup)
  ];
  for (const role of roles) {
    exec(`gcloud projects add-iam-policy-binding ${cfg.project} \
      --member="serviceAccount:${saEmail}" \
      --role="${role}" \
      --condition=None \
      --quiet`);
    ok(role);
  }

  section('GCP — Artifact Registry');

  const arExists = tryRun(`gcloud artifacts repositories describe ${AR_REPO} \
    --location=${cfg.region} --project=${cfg.project} --format='value(name)'`);
  if (arExists) {
    ok(`repository exists: ${AR_REPO}`);
  } else {
    exec(`gcloud artifacts repositories create ${AR_REPO} \
      --repository-format=docker \
      --location=${cfg.region} \
      --project=${cfg.project} \
      --description="Docket container images"`);
    ok(`created: ${AR_REPO}`);
  }

  section('GCP — Workload Identity Federation');

  const poolExists = tryRun(`gcloud iam workload-identity-pools describe ${WIF_POOL} \
    --location=global --project=${cfg.project} --format='value(name)'`);
  if (poolExists) {
    ok(`pool exists: ${WIF_POOL}`);
  } else {
    exec(`gcloud iam workload-identity-pools create ${WIF_POOL} \
      --location=global \
      --project=${cfg.project} \
      --display-name="GitHub Actions"`);
    ok(`created pool: ${WIF_POOL}`);
  }

  const providerExists =
    tryRun(`gcloud iam workload-identity-pools providers describe ${WIF_PROVIDER} \
    --workload-identity-pool=${WIF_POOL} \
    --location=global --project=${cfg.project} --format='value(name)'`);
  if (providerExists) {
    ok(`provider exists: ${WIF_PROVIDER}`);
  } else {
    exec(`gcloud iam workload-identity-pools providers create-oidc ${WIF_PROVIDER} \
      --workload-identity-pool=${WIF_POOL} \
      --location=global \
      --project=${cfg.project} \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
      --attribute-condition="assertion.repository=='${cfg.repo}'"`);
    ok(`created provider: ${WIF_PROVIDER}`);
  }

  // Bind SA to WIF pool (scoped to this repo only)
  const member = `principalSet://iam.googleapis.com/projects/${cfg.projectNumber}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${cfg.repo}`;
  exec(`gcloud iam service-accounts add-iam-policy-binding ${saEmail} \
    --project=${cfg.project} \
    --role="roles/iam.workloadIdentityUser" \
    --member="${member}" \
    --condition=None`);
  ok('SA bound to WIF pool (scoped to this repo)');

  const wifProvider = `projects/${cfg.projectNumber}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}`;

  section('GCP — Secret Manager');

  // These PROD secrets are generated/entered, held only in memory, and piped straight into
  // Secret Manager via stdin (--data-file=-) — they are NEVER written to local disk. The local
  // .env.local later generates its OWN independent dev secrets (see writeEnvLocal).
  const secrets: { name: string; value: string; label: string }[] = [
    { name: 'docket-database-url', value: cfg.databaseUrl, label: 'DATABASE_URL' },
    {
      name: 'docket-auth-secret',
      value: run('openssl rand -base64 32'),
      label: 'BETTER_AUTH_SECRET',
    },
    { name: 'docket-cron-secret', value: run('openssl rand -hex 24'), label: 'CRON_SECRET' },
  ];

  const created: string[] = [];
  const skipped: string[] = [];
  for (const { name, value, label } of secrets) {
    const exists = tryRun(
      `gcloud secrets describe ${name} --project=${cfg.project} --format='value(name)'`,
    );
    if (exists) {
      skipped.push(`• ${name} (${label}) — already exists, left as-is`);
    } else {
      execSync(
        `gcloud secrets create ${name} --project=${cfg.project} --replication-policy=automatic --data-file=-`,
        { input: value, stdio: ['pipe', 'inherit', 'inherit'] },
      );
      created.push(`✓ ${name} (${label})`);
    }
  }
  note([...created, ...skipped].join('\n') || '(none)', 'Secret Manager');

  return { saEmail, wifProvider };
}

// ── github ────────────────────────────────────────────────────────────────────

function setupGithub(cfg: Config, saEmail: string, wifProvider: string): void {
  section('GitHub — Repository Variables');

  const repoVars: Record<string, string> = {
    GCP_PROJECT_ID: cfg.project,
    GCP_REGION: cfg.region,
    GCP_SERVICE_ACCOUNT: saEmail,
    GCP_WIF_PROVIDER: wifProvider,
    NEON_PROJECT_ID: cfg.neonProjectId,
  };
  const productionVars: Record<string, string> = {
    PASSKEY_RP_ID: cfg.domain,
    API_URL: cfg.apiUrl,
    WEB_URL: cfg.webUrl,
    ADMIN_URL: cfg.adminUrl,
    BETTER_AUTH_ALLOWED_HOSTS: [
      new URL(cfg.webUrl).host,
      new URL(cfg.apiUrl).host,
      new URL(cfg.adminUrl).host,
    ].join(','),
    GOOGLE_OAUTH_PUBLIC: 'false',
  };

  for (const [key, value] of Object.entries(repoVars)) {
    exec(`gh variable set ${key} --body "${value}" --repo ${cfg.repo}`);
    ok(key);
  }
  for (const [key, value] of Object.entries(productionVars)) {
    exec(`gh variable set ${key} --env production --body "${value}" --repo ${cfg.repo}`);
    ok(`${key} (production)`);
  }

  const configuredSecrets = new Set(
    tryRun(`gcloud secrets list --project=${cfg.project} --format='value(name)'`)
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  execFileSync(
    'gh',
    [
      'variable',
      'set',
      'API_SECRET_BINDINGS',
      '--env',
      'production',
      '--repo',
      cfg.repo,
      '--body',
      buildApiSecretBindings('production', configuredSecrets).join('\n'),
    ],
    { stdio: 'inherit' },
  );
  ok('API_SECRET_BINDINGS');

  section('GitHub — Repository Secrets');

  if (cfg.neonApiKey !== null) {
    execSync(`gh secret set NEON_API_KEY --repo ${cfg.repo}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
      input: cfg.neonApiKey,
    });
    ok('NEON_API_KEY');
  }
}

// ── .env.local ────────────────────────────────────────────────────────────────

function writeEnvLocal(): void {
  section('Local dev env (.env.local)');

  // .env.local holds ONLY local dev values. Its secrets are generated FRESH here and are
  // independent of the production secrets in Secret Manager — no prod value is ever written
  // to disk (dev ≠ prod, same var names, different values).
  const envPath = resolve(ROOT, '.env.local');
  const authSecret = run('openssl rand -base64 32');
  const cronSecret = run('openssl rand -hex 24');

  const content = `# Generated by pnpm bootstrap — local dev only. Do not commit. Contains no prod values.
# Edit values as needed for local development.

APP_MODE=local
NODE_ENV=development

# API
PORT=3001
API_URL=https://api.docket.localhost
WEB_URL=https://docket.localhost

# Database — local Docker Postgres (pnpm db:up)
DATABASE_URL=postgres://docket:docket@localhost:5433/docket
DATABASE_URL_UNPOOLED=postgres://docket:docket@localhost:5433/docket

# Auth
BETTER_AUTH_SECRET=${authSecret}
BETTER_AUTH_URL=https://api.docket.localhost
BETTER_AUTH_TRUSTED_ORIGINS=https://docket.localhost,https://admin.docket.localhost
# Dynamic per-request base URL (required: web + admin each proxy /api/auth to the API, so auth must
# resolve its base to whichever frontend the browser is on — keeps the OAuth callback + cookie on
# the right origin). BETTER_AUTH_URL above is the fallback for header-less/direct requests.
BETTER_AUTH_ALLOWED_HOSTS=docket.localhost,admin.docket.localhost,api.docket.localhost
# OAuth proxy (blank locally → not mounted → direct local OAuth). Set both on prod/previews so
# previews route OAuth through prod's registered callback; OAUTH_PROXY_SECRET must match across them.
OAUTH_PROXY_SECRET=
OAUTH_PROXY_PRODUCTION_URL=
BETTER_AUTH_PASSKEY_RP_ID=docket.localhost
BETTER_AUTH_PASSKEY_RP_NAME=Docket (local)

# Ops
CRON_SECRET=${cronSecret}
BILLING_ENABLED=false
MCP_TASKS_ENABLED=false
MCP_CIMD_STRICT=false

# Client (picked up by Next.js apps)
NEXT_PUBLIC_API_URL=https://api.docket.localhost
NEXT_PUBLIC_APP_URL=https://docket.localhost
`;

  if (!existsSync(envPath)) {
    writeFileSync(envPath, content, 'utf8');
    ok('.env.local written');
    return;
  }

  // Non-destructive: keep every existing value (incl. already-set secrets and integration
  // keys) and only fill in skeleton keys that are missing.
  const present = parseEnvFile(envPath);
  const missing: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    // Treat a present-but-empty key as missing so the skeleton default fills it in.
    if (!present[key]) missing[key] = line.slice(eq + 1).trim();
  }
  if (Object.keys(missing).length === 0) {
    ok('.env.local already complete — no skeleton keys to add');
    return;
  }
  upsertEnvVars(envPath, missing);
  ok(`.env.local updated — added ${Object.keys(missing).join(', ')}`);
}

// ── next steps ────────────────────────────────────────────────────────────────

function printNextSteps(cfg: Config): void {
  const registry = `${cfg.region}-docker.pkg.dev/${cfg.project}/${AR_REPO}`;

  note(
    [
      '1) Run DB migrations against Neon:',
      '     DATABASE_URL_UNPOOLED="<your-unpooled-url>" pnpm db:migrate',
      '',
      '2) Push to main — GitHub Actions builds and deploys all 3 services.',
      "     The first deploy fails for web/admin (API_URL not set yet). That's expected.",
      '',
      '3) After the API deploys, get its URL:',
      `     gcloud run services describe docket-api --region=${cfg.region} \\`,
      `       --project=${cfg.project} --format='value(status.url)'`,
      '',
      '4) Set the URL variables (replace with your actual URLs):',
      `     gh variable set API_URL   --body "https://..." --repo ${cfg.repo}`,
      `     gh variable set WEB_URL   --body "https://..." --repo ${cfg.repo}`,
      `     gh variable set ADMIN_URL --body "https://..." --repo ${cfg.repo}`,
      '',
      '5) Push again — all services deploy successfully.',
      '6) Optional — custom domains via Cloud Run domain mappings or a GCP Load Balancer.',
      '',
      `Artifact Registry: ${registry}`,
    ].join('\n'),
    'Next steps',
  );
}

/** Merge a host/origin into a comma-separated env var in `.env.local` (idempotent). */
function mergeCsvEnvVar(envPath: string, key: string, value: string): void {
  const current = parseEnvFile(envPath)[key] ?? '';
  const parts = current
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.includes(value)) return;
  upsertEnvVars(envPath, { [key]: [...parts, value].join(',') });
}

/** Resolve a cloudflared tunnel's id by name, creating it if absent. Returns '' on failure. */
function ensureTunnel(name: string): string {
  const findId = (): string => {
    try {
      const list = JSON.parse(tryRun('cloudflared tunnel list --output json')) as {
        id: string;
        name: string;
      }[];
      return list.find((t) => t.name === name)?.id ?? '';
    } catch {
      return '';
    }
  };
  const existing = findId();
  if (existing) {
    ok(`Reusing tunnel ${name} (${existing}).`);
    return existing;
  }
  try {
    exec(`cloudflared tunnel create ${name}`);
  } catch {
    return '';
  }
  return findId();
}

/**
 * The local port the API is listening on, read from portless's route table.
 *
 * @remarks
 * portless assigns each app a stable per-name port and records it in `~/.portless/routes.json`. The
 * tunnel routes `/api`+`/v1` straight to this port (preserving the public Host — see `tunnel.ts`),
 * so the table must be populated, i.e. `pnpm dev` must have run at least once. Matches the `api.*`
 * route by name so it works in worktrees too.
 */
function readPortlessApiPort(): number | undefined {
  const routesPath = resolve(homedir(), '.portless', 'routes.json');
  if (!existsSync(routesPath)) return undefined;
  try {
    const routes = JSON.parse(readFileSync(routesPath, 'utf8')) as readonly {
      hostname?: string;
      port?: number;
    }[];
    const api = routes.find((r) => typeof r.hostname === 'string' && r.hostname.startsWith('api.'));
    return typeof api?.port === 'number' ? api.port : undefined;
  } catch {
    return undefined;
  }
}

/** Write + (re)load the user LaunchAgent so the tunnel runs at login (persistent, no sudo). */
function installTunnelAgent(cfBin: string, configPath: string, tunnel: string): void {
  if (process.platform !== 'darwin') {
    note(
      `Run the tunnel persistently for your OS, e.g.:  ${cfBin} tunnel --config ${configPath} run ${tunnel}`,
      'tunnel persistence',
    );
    return;
  }
  const label = 'studio.hypertext.docket-tunnel';
  const plistPath = resolve(homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const logPath = resolve(homedir(), '.cloudflared', 'docket-tunnel.log');
  writeFileSync(
    plistPath,
    launchAgentPlist({ label, cloudflaredBin: cfBin, configPath, tunnel, logPath }),
  );
  tryRun(`launchctl unload ${plistPath}`);
  tryRun(`launchctl load -w ${plistPath}`);
  ok(`Tunnel runs persistently via LaunchAgent (${plistPath}).`);
}

/** Ensure `BETTER_AUTH_ALLOWED_HOSTS` carries the local hosts + the tunnel host (idempotent). */
function ensureAllowlistHosts(envPath: string, hostname: string): void {
  const current = parseEnvFile(envPath)['BETTER_AUTH_ALLOWED_HOSTS'] ?? '';
  const base =
    current.trim().length > 0
      ? current
      : 'docket.localhost,admin.docket.localhost,marketing.docket.localhost,api.docket.localhost';
  const parts = base
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.includes(hostname)) parts.push(hostname);
  upsertEnvVars(envPath, { BETTER_AUTH_ALLOWED_HOSTS: parts.join(',') });
}

/**
 * Set up local OAuth + a persistent tunnel (Phase 1, opt-in) — all automated.
 *
 * @remarks
 * Two independent opt-ins, folded into bootstrap (no separate command):
 *  - **Shared OAuth proxy** — point this machine at the team's always-on anchor host so real
 *    Google/GitHub sign-in works locally with NO per-dev Google registration (Better Auth's
 *    `oAuthProxy` relays through the one registered callback). Just two env vars; no tunnel.
 *  - **Personal cloudflared tunnel** — give this stack a public, Google-acceptable URL. This step
 *    actually DOES the work: ensures cloudflared, logs in, creates/reuses the named tunnel, routes
 *    DNS, writes the config, runs it persistently via a user LaunchAgent, and allowlists the host
 *    in `.env.local`. The only things left to the operator are the Google Console redirect-URI
 *    paste (their project) and a `pnpm dev` restart (to load the env).
 */
async function setupDevTunnel(): Promise<void> {
  const envPath = resolve(ROOT, '.env.local');

  const useProxy = unwrap(
    await confirm({
      message:
        'Link real Google/GitHub locally via the team OAuth proxy? (no tunnel; needs the shared anchor URL + secret)',
      initialValue: false,
    }),
  );
  if (useProxy) {
    const anchor = await prompt(
      'Shared anchor URL (the team host registered with Google)',
      '',
      'https://docket-dev.hypertext.studio',
    );
    const secret = unwrap(
      await password({
        message: 'OAUTH_PROXY_SECRET (shared across the team — from your secret store)',
      }),
    );
    if (anchor && secret) {
      upsertEnvVars(envPath, { OAUTH_PROXY_PRODUCTION_URL: anchor, OAUTH_PROXY_SECRET: secret });
      ok('OAuth proxy configured — local sign-in relays through the shared anchor.');
    } else {
      warn('Skipped OAuth proxy (both the anchor URL and secret are required).');
    }
  }

  const wantTunnel = unwrap(
    await confirm({
      message:
        'Set up a persistent cloudflared tunnel for this machine (real OAuth + inbound webhooks)?',
      initialValue: false,
    }),
  );
  if (!wantTunnel) return;

  // 1. Prerequisite — check + install cloudflared (never assume it's present).
  if (!(await ensureCloudflared())) return;
  const cfBin = firstLine('command -v cloudflared') || 'cloudflared';
  const cfDir = resolve(homedir(), '.cloudflared');

  // 2. Cloudflare auth — interactive browser login only if there's no cert yet.
  if (!existsSync(resolve(cfDir, 'cert.pem'))) {
    note(
      'Authorizing cloudflared with your Cloudflare account — a browser will open.',
      'cloudflared login',
    );
    try {
      exec('cloudflared tunnel login');
    } catch {
      warn('Login did not complete — run `cloudflared tunnel login`, then re-run bootstrap.');
      return;
    }
  }

  // 3. Name + hostname.
  const tunnel = await prompt('Tunnel name', 'docket-dev', 'docket-dev');
  const hostname = await prompt(
    'Public hostname (a subdomain on YOUR Cloudflare zone)',
    '',
    'docket-dev.hypertext.studio',
  );
  if (!hostname) {
    warn('Skipped tunnel setup (a public hostname is required).');
    return;
  }

  // 4. Create/reuse the tunnel, route DNS, write the config.
  const id = ensureTunnel(tunnel);
  if (!id) {
    warn('Could not create/find the tunnel — check `cloudflared tunnel list` and re-run.');
    return;
  }
  tryRun(`cloudflared tunnel route dns ${tunnel} ${hostname}`);
  const apiPort = readPortlessApiPort();
  if (!apiPort) {
    warn(
      'Could not find the local API port in ~/.portless/routes.json — the tunnel routes /api + /v1 ' +
        'straight to it. Start `pnpm dev` once (so portless registers the route), then re-run bootstrap.',
    );
    return;
  }
  const configPath = resolve(cfDir, 'config.yml');
  writeFileSync(
    configPath,
    cloudflaredConfigYaml({
      tunnel,
      hostname,
      credentialsFile: resolve(cfDir, `${id}.json`),
      apiPort,
    }),
  );
  ok(`Wrote ${configPath} (API → :${String(apiPort)}) and routed ${hostname}.`);

  // 5. Persistence (user LaunchAgent, no sudo) + env allowlist.
  installTunnelAgent(cfBin, configPath, tunnel);
  ensureAllowlistHosts(envPath, hostname);
  mergeCsvEnvVar(envPath, 'BETTER_AUTH_TRUSTED_ORIGINS', `https://${hostname}`);
  ok(`Allowlisted ${hostname} in .env.local.`);

  // 6. The two irreducible operator steps.
  const urls = tunnelRegistrationUrls(hostname);
  note(
    [
      'Tunnel is live + persistent. Two things only you can do:',
      '',
      '1. In your Google OAuth client, add:',
      `   • Authorized redirect URI : ${urls.googleRedirectUri}`,
      `   • Authorized JS origin     : ${urls.googleOrigin}`,
      '2. Restart `pnpm dev` (loads BETTER_AUTH_ALLOWED_HOSTS), then sign in at:',
      `   ${urls.googleOrigin}`,
      '',
      `GitHub firehose (optional): point a GitHub App webhook at ${urls.githubWebhook}`,
    ].join('\n'),
    'cloudflared tunnel — set up',
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseBootstrapFlags(process.argv.slice(2));
  intro('Docket bootstrap — local dev setup (+ optional production)');

  if (flags.help) {
    note(bootstrapHelp(), 'Bootstrap flags');
    outro('No changes made.');
    return;
  }

  note(
    [
      'First, this sets up your local development environment:',
      '  • writes a local-only .env.local (its own dev secrets, mock mode)',
      '  • optionally walks you through local OAuth/integration credentials',
      '',
      'Then it optionally provisions production (only if you opt in):',
      '  • GCP service account, Workload Identity, Artifact Registry, Secret Manager',
      '  • GitHub Actions variables + the Neon API key secret',
      '',
      'Prod secrets are pushed straight to Secret Manager / GitHub — never written to disk.',
      '',
      'Use `pnpm bootstrap -- --help` to skip or force whole phases explicitly.',
    ].join('\n'),
    'Overview',
  );

  // ── Phase 1 — local development (the priority) ──────────────────────────────
  if (!flags.skipLocal) {
    checkDevPrereqs();
    writeEnvLocal();
    if (!flags.skipProviders) {
      const localIntegrations = unwrap(
        await confirm({
          message: 'Set up all local provider credentials now (Google/GitHub/Linear/… for dev)?',
          initialValue: false,
        }),
      );
      if (localIntegrations) {
        await runIntegrationSetup({ environments: ['local'], embedded: true });
      }
    }
    if (!flags.skipTunnel) await setupDevTunnel();
  } else {
    ok('Skipped local setup (--skip-local).');
  }

  // ── Phase 2 — production (opt-in) ───────────────────────────────────────────
  const doProd = flags.skipProduction
    ? false
    : flags.production
      ? true
      : unwrap(
          await confirm({
            message: 'Also provision production now (GCP + GitHub)? You can run this later.',
            initialValue: false,
          }),
        );
  if (!doProd) {
    note(
      [
        'Local dev is ready. To run it:',
        '  • pnpm db:up        # start local Postgres (Docker)',
        '  • pnpm db:migrate   # apply migrations',
        '  • pnpm dev          # start the apps',
        '',
        'When you are ready for production, re-run `pnpm bootstrap` and opt in.',
      ].join('\n'),
      'Next steps — local dev',
    );
    outro('Local dev ready.');
    return;
  }

  checkProdPrereqs();
  await confirmAuthAccounts();
  if (flags.skipInfrastructure) {
    const repo = detectRepo();
    if (!repo) throw new Error('Could not detect the GitHub owner/repo from origin');
    const githubProject = tryRun(`gh variable get GCP_PROJECT_ID --repo ${repo} 2>/dev/null`);
    const project =
      githubProject !== '' ? githubProject : tryRun('gcloud config get-value project 2>/dev/null');
    if (!project) {
      throw new Error('Could not resolve the production GCP project from GitHub or gcloud');
    }
    ok('Skipped production infrastructure provisioning (--skip-infrastructure).');
    if (!flags.skipProviders) {
      await runIntegrationSetup({
        environments: ['production'],
        repo,
        defaultProject: project,
        authConfirmed: true,
        embedded: true,
      });
    } else {
      warn('Skipped mandatory production providers by explicit request (--skip-providers).');
    }
    outro('Bootstrap complete — existing production foundation reused.');
    return;
  }
  const cfg = await gatherConfig();
  const { saEmail, wifProvider } = setupGcp(cfg);
  setupGithub(cfg, saEmail, wifProvider);

  if (!flags.skipProviders) {
    await runIntegrationSetup({
      environments: ['production'],
      repo: cfg.repo,
      defaultProject: cfg.project,
      authConfirmed: true,
      embedded: true,
    });
  } else {
    warn('Skipped mandatory production providers by explicit request (--skip-providers).');
  }

  printNextSteps(cfg);
  outro('Bootstrap complete — local dev + production provisioned.');
}

// Self-invoke only when run directly (tests import the pure flag parser).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    cancel(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
