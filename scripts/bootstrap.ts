/**
 * `pnpm bootstrap` — set up Docket for local development, and optionally provision production.
 *
 * @remarks
 * Dev-first flow:
 *   Phase 1 (always): check dev tools (openssl/docker) → write a local-only `.env.local`
 *     (its own freshly-generated dev secrets) → optionally walk through local integrations.
 *   Phase 2 (opt-in): provision production — gcloud/gh prereqs + account confirmation, GCP
 *     APIs/service account/WIF/Artifact Registry/Secret Manager, GitHub Actions vars + secrets,
 *     optionally production integrations.
 *
 * Production secrets are held in memory and pushed straight to Secret Manager / GitHub — never
 * written to disk. Idempotent — safe to re-run; existing resources are detected and skipped.
 * Cloud Run URLs are unknown until the first deploy; the script prints the follow-up commands.
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { cancel, confirm, intro, log, note, outro, password, text } from '@clack/prompts';

import {
  chooseGcloudProject,
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SA_NAME = 'docket-deploy';
const AR_REPO = 'docket';
const WIF_POOL = 'github';
const WIF_PROVIDER = 'github-actions';

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

  const vars: Record<string, string> = {
    GCP_PROJECT_ID: cfg.project,
    GCP_REGION: cfg.region,
    GCP_SERVICE_ACCOUNT: saEmail,
    GCP_WIF_PROVIDER: wifProvider,
    PASSKEY_RP_ID: cfg.domain,
    NEON_PROJECT_ID: cfg.neonProjectId,
    API_URL: cfg.apiUrl,
    WEB_URL: cfg.webUrl,
    ADMIN_URL: cfg.adminUrl,
  };

  for (const [key, value] of Object.entries(vars)) {
    exec(`gh variable set ${key} --body "${value}" --repo ${cfg.repo}`);
    ok(key);
  }

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

# Database — local Docker Postgres (pnpm db:up)
DATABASE_URL=postgres://docket:docket@localhost:5433/docket
DATABASE_URL_UNPOOLED=postgres://docket:docket@localhost:5433/docket

# Auth
BETTER_AUTH_SECRET=${authSecret}
BETTER_AUTH_URL=https://api.docket.localhost
BETTER_AUTH_TRUSTED_ORIGINS=https://docket.localhost,https://admin.docket.localhost
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

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  intro('Docket bootstrap — local dev setup (+ optional production)');

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
    ].join('\n'),
    'Overview',
  );

  // ── Phase 1 — local development (the priority) ──────────────────────────────
  checkDevPrereqs();
  writeEnvLocal();
  const localIntegrations = unwrap(
    await confirm({
      message: 'Set up local integration credentials now (Google/GitHub/Stripe/… for dev)?',
      initialValue: false,
    }),
  );
  if (localIntegrations) {
    await runIntegrationSetup({ environments: ['local'], embedded: true });
  }

  // ── Phase 2 — production (opt-in) ───────────────────────────────────────────
  const doProd = unwrap(
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
  const cfg = await gatherConfig();
  const { saEmail, wifProvider } = setupGcp(cfg);
  setupGithub(cfg, saEmail, wifProvider);

  const prodIntegrations = unwrap(
    await confirm({
      message: 'Set up production integration credentials now (OAuth/Stripe/…)?',
      initialValue: false,
    }),
  );
  if (prodIntegrations) {
    await runIntegrationSetup({
      environments: ['production'],
      repo: cfg.repo,
      defaultProject: cfg.project,
      authConfirmed: true,
      embedded: true,
    });
  }

  printNextSteps(cfg);
  outro('Bootstrap complete — local dev + production provisioned.');
}

main().catch((err: unknown) => {
  cancel(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
