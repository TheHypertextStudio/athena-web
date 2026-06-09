/**
 * `pnpm bootstrap` — one-time GCP + GitHub setup for Docket production deployment.
 *
 * @remarks
 * Sets up in order:
 *   1. Prerequisite checks (gcloud, gh, openssl)
 *   2. GCP APIs, service account, roles, Artifact Registry, WIF, Secret Manager
 *   3. GitHub repository variables and secrets (via gh CLI)
 *   4. Local .env.local skeleton
 *
 * Idempotent — safe to re-run. Already-existing resources are detected and skipped.
 * Cloud Run service URLs are unknown until after the first deploy; the script prints
 * exact follow-up commands to set them once services are live.
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SA_NAME = 'docket-deploy';
const AR_REPO = 'docket';
const WIF_POOL = 'github';
const WIF_PROVIDER = 'github-actions';

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function exec(cmd: string): void {
  execSync(cmd, { encoding: 'utf8', stdio: 'inherit' });
}

function tryRun(cmd: string): string {
  try {
    return run(cmd);
  } catch {
    return '';
  }
}

function ok(msg: string): void {
  console.log(`  ✓  ${msg}`);
}

function step(msg: string): void {
  console.log(`  →  ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ⚠  ${msg}`);
}

function section(title: string): void {
  const bar = '─'.repeat(Math.max(0, 62 - title.length));
  console.log(`\n── ${title} ${bar}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string, fallback = ''): Promise<string> {
  return new Promise((res) => {
    const hint = fallback ? ` [${fallback}]` : '';
    rl.question(`  ${question}${hint}: `, (ans) => {
      res(ans.trim() || fallback);
    });
  });
}

// ── prerequisite checks ───────────────────────────────────────────────────────

function checkPrereqs(): void {
  section('Prerequisites');

  // 1. Binary presence
  const tools = [
    {
      cmd: 'gcloud --version',
      name: 'gcloud',
      install: 'https://cloud.google.com/sdk/docs/install',
    },
    { cmd: 'gh --version', name: 'gh (GitHub CLI)', install: 'https://cli.github.com' },
    { cmd: 'openssl version', name: 'openssl', install: 'brew install openssl' },
    { cmd: 'docker --version', name: 'docker', install: 'https://docs.docker.com/get-docker/' },
  ];
  let failed = false;
  for (const { cmd, name, install } of tools) {
    if (tryRun(cmd)) {
      ok(name);
    } else {
      console.error(`  ✗  ${name} not found — install: ${install}`);
      failed = true;
    }
  }
  if (failed) {
    console.error('\nInstall missing tools and re-run pnpm bootstrap.');
    process.exit(1);
  }

  // 2. Auth state
  section('Auth state');

  const gcloudAccount = tryRun(
    "gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null",
  );
  if (gcloudAccount) {
    ok(`gcloud authenticated as ${gcloudAccount}`);
  } else {
    console.error('  ✗  gcloud is not authenticated — run: gcloud auth login');
    failed = true;
  }

  const ghUser = tryRun('gh auth status --hostname github.com 2>&1 | grep "Logged in"');
  if (ghUser) {
    ok(`gh authenticated (${ghUser.trim()})`);
  } else {
    console.error('  ✗  gh is not authenticated — run: gh auth login');
    failed = true;
  }

  if (failed) {
    console.error('\nAuthenticate missing tools and re-run pnpm bootstrap.');
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
  neonProjectId: string;
  neonApiKey: string;
  databaseUrl: string;
  databaseUrlUnpooled: string;
}

async function gatherConfig(): Promise<Config> {
  section('Configuration');

  const currentProject = tryRun('gcloud config get-value project');
  const project = await prompt('GCP project ID', currentProject);
  if (!project) {
    console.error('GCP project ID is required.');
    process.exit(1);
  }

  const projectNumber = run(`gcloud projects describe ${project} --format='value(projectNumber)'`);
  ok(`project number: ${projectNumber}`);

  const region = await prompt('GCP region', 'us-central1');

  // Detect GitHub remote
  const remoteUrl = tryRun('git remote get-url origin');
  const repoMatch = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remoteUrl);
  const detectedRepo = repoMatch ? repoMatch[1] : '';
  const repo = await prompt('GitHub owner/repo', detectedRepo);

  const domain = await prompt('Passkey relying-party domain (e.g. docket.dev)');
  if (!domain) {
    console.error('Passkey domain is required.');
    process.exit(1);
  }

  console.log('\n  Neon (free tier: neon.tech → New project → Connection details)');
  const neonProjectId = await prompt('Neon project ID');
  const neonApiKey = await prompt('Neon API key (from neon.tech → Account → API keys)');
  const databaseUrl = await prompt('Neon DATABASE_URL (pooled)');
  const databaseUrlUnpooled = await prompt(
    'Neon DATABASE_URL_UNPOOLED (for migrations)',
    databaseUrl,
  );

  return {
    project,
    projectNumber,
    region,
    repo,
    domain,
    neonProjectId,
    neonApiKey,
    databaseUrl,
    databaseUrlUnpooled,
  };
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

  const authSecret = run('openssl rand -base64 32');
  const cronSecret = run('openssl rand -hex 24');

  const secrets: { name: string; value: string; label: string }[] = [
    { name: 'docket-database-url', value: cfg.databaseUrl, label: 'DATABASE_URL' },
    { name: 'docket-auth-secret', value: authSecret, label: 'BETTER_AUTH_SECRET (generated)' },
    { name: 'docket-cron-secret', value: cronSecret, label: 'CRON_SECRET (generated)' },
  ];

  const tmpDir = mkdtempSync(resolve(tmpdir(), 'docket-bootstrap-'));
  for (const { name, value, label } of secrets) {
    const exists = tryRun(
      `gcloud secrets describe ${name} --project=${cfg.project} --format='value(name)'`,
    );
    if (exists) {
      warn(`secret exists, skipping: ${name} — update manually if needed`);
    } else {
      const tmpFile = resolve(tmpDir, name);
      writeFileSync(tmpFile, value, { encoding: 'utf8', mode: 0o600 });
      try {
        exec(`gcloud secrets create ${name} \
          --project=${cfg.project} \
          --replication-policy=automatic \
          --data-file=${tmpFile}`);
        ok(`created secret: ${name} (${label})`);
      } finally {
        unlinkSync(tmpFile);
      }
    }
  }

  // Store generated secrets for .env.local
  process.env['_BOOTSTRAP_AUTH_SECRET'] = authSecret;
  process.env['_BOOTSTRAP_CRON_SECRET'] = cronSecret;

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
    // URL vars are set after first deploy — placeholders silenced by a note below
    API_URL: '',
    WEB_URL: '',
    ADMIN_URL: '',
  };

  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue; // skip empty (URL vars deferred)
    exec(`gh variable set ${key} --body "${value}" --repo ${cfg.repo}`);
    ok(key);
  }

  section('GitHub — Repository Secrets');

  if (cfg.neonApiKey) {
    execSync(`gh secret set NEON_API_KEY --repo ${cfg.repo}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
      input: cfg.neonApiKey,
    });
    ok('NEON_API_KEY');
  }
}

// ── .env.local ────────────────────────────────────────────────────────────────

function writeEnvLocal(_cfg: Config): void {
  section('Local — .env.local');

  const envPath = resolve(ROOT, '.env.local');
  if (existsSync(envPath)) {
    ok('.env.local already exists — skipping (delete it to regenerate)');
    return;
  }

  const authSecret = process.env['_BOOTSTRAP_AUTH_SECRET'] ?? run('openssl rand -base64 32');
  const cronSecret = process.env['_BOOTSTRAP_CRON_SECRET'] ?? run('openssl rand -hex 24');

  const content = `# Generated by pnpm bootstrap — do NOT commit this file.
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
BETTER_AUTH_TRUSTED_ORIGINS=https://web.docket.localhost,https://admin.docket.localhost
BETTER_AUTH_PASSKEY_RP_ID=docket.localhost
BETTER_AUTH_PASSKEY_RP_NAME=Docket (local)

# Ops
CRON_SECRET=${cronSecret}
BILLING_ENABLED=false
MCP_TASKS_ENABLED=false
MCP_CIMD_STRICT=false

# Client (picked up by Next.js apps)
NEXT_PUBLIC_API_URL=https://api.docket.localhost
NEXT_PUBLIC_APP_URL=https://web.docket.localhost
`;

  writeFileSync(envPath, content, 'utf8');
  ok('.env.local written');
}

// ── next steps ────────────────────────────────────────────────────────────────

function printNextSteps(cfg: Config): void {
  const registry = `${cfg.region}-docker.pkg.dev/${cfg.project}/${AR_REPO}`;

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  Bootstrap complete. Next steps:                                 ║
╚══════════════════════════════════════════════════════════════════╝

1. Run DB migrations against Neon:
   DATABASE_URL_UNPOOLED="<your-unpooled-url>" pnpm db:migrate

2. Push to main — GitHub Actions will build and deploy all 3 services.
   The first deploy will fail for web/admin (API_URL not set yet). That's expected.

3. After the API deploys, get its URL:
   gcloud run services describe docket-api \\
     --region=${cfg.region} --project=${cfg.project} \\
     --format='value(status.url)'

4. Set the URL variables (replace with your actual URLs):
   gh variable set API_URL  --body "https://..." --repo ${cfg.repo}
   gh variable set WEB_URL  --body "https://..." --repo ${cfg.repo}
   gh variable set ADMIN_URL --body "https://..." --repo ${cfg.repo}

5. Push again — all services deploy successfully.

6. Optional — custom domains via Cloud Run domain mappings or GCP Load Balancer.

Artifact Registry: ${registry}
`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nDocket bootstrap — GCP + GitHub production setup\n');

  checkPrereqs();

  const cfg = await gatherConfig();
  const { saEmail, wifProvider } = setupGcp(cfg);
  setupGithub(cfg, saEmail, wifProvider);
  writeEnvLocal(cfg);
  printNextSteps(cfg);

  rl.close();
}

main().catch((err: unknown) => {
  console.error('\nBootstrap failed:', err instanceof Error ? err.message : String(err));
  rl.close();
  process.exit(1);
});
