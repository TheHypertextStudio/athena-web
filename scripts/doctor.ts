/**
 * `pnpm doctor` — report where a live deployment has drifted from what bootstrap provisions.
 *
 * @remarks
 * `bootstrap.ts` describes each resource only to decide create-versus-skip, inside the write path,
 * reporting nothing. So nothing has ever answered the question that matters between deploys: does
 * this project still look like the one bootstrap set up? Drift has broken production repeatedly —
 * a repository variable that was never created, an org role granted by hand and never recorded, a
 * service running as the wrong account.
 *
 * Read-only, and deliberately dumb about remediation: it names what differs and leaves fixing to
 * `pnpm bootstrap`, which owns the write path. Every expectation is imported from that script
 * rather than restated, so the two cannot disagree.
 *
 * The comparison is pure and the cloud reads are injected, following `validateSecretBindings` and
 * `evaluateBillingRuntimeRollout` — so the interesting cases are provable without a project.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

import {
  API_RUNTIME_ORG_ROLE,
  API_RUNTIME_SA_NAME,
  API_RUNTIME_SA_ROLES,
  AR_REPO,
  DEPLOY_SA_ROLES,
  REQUIRED_GCP_APIS,
  SA_NAME,
  WIF_POOL,
  WIF_PROVIDER,
} from './bootstrap';

/**
 * One thing checked.
 *
 * @remarks
 * `unknown` exists because an unreadable boundary is not evidence of absence. An expired `gh`
 * token makes every variable look missing, and reporting that as failure would block deploys on a
 * credential problem while describing it as drift — louder and wronger than saying nothing.
 */
export interface DoctorCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'unknown';
  readonly detail: string;
}

/** What the doctor found, in a form safe to print: never a secret value. */
export interface DoctorReport {
  readonly project: string;
  /** False when anything definitely drifted. Unknowns do not fail it — they are reported instead. */
  readonly passed: boolean;
  readonly checks: readonly DoctorCheck[];
}

/**
 * Live state, as read from Google Cloud and GitHub.
 *
 * @remarks
 * Every field is what the boundary observed, so {@link diagnose} can be exercised against any
 * combination — including the ones that have actually broken production — without a project.
 */
export interface Observation {
  readonly project: string;
  /** API service names currently enabled, or null when unreadable. */
  readonly enabledApis: readonly string[] | null;
  /** Service-account emails that exist, or null when unreadable. */
  readonly serviceAccounts: readonly string[] | null;
  /** Project-level IAM, keyed by member; null for a member whose policy could not be read. */
  readonly projectRoles: Readonly<Record<string, readonly string[] | null>>;
  /** Org-level IAM for the runtime account, or null when no organization could be resolved. */
  readonly orgRoles: readonly string[] | null;
  /** Artifact Registry repository names in the region, or null when unreadable. */
  readonly artifactRepos: readonly string[] | null;
  /** Workload Identity pool and provider ids that exist, or null when unreadable. */
  readonly wifPools: readonly string[] | null;
  readonly wifProviders: readonly string[] | null;
  /** Repository-scoped GitHub Actions variable names, or null when GitHub could not be read. */
  readonly repoVars: readonly string[] | null;
  /** Production-environment variable names, or null when GitHub could not be read. */
  readonly environmentVars: readonly string[] | null;
  /** The service account the deployed API runs as, or null when Cloud Run could not be read. */
  readonly apiRuntimeServiceAccount: string | null;
}

/** The repository-scoped variables the deploy reads. */
const EXPECTED_REPO_VARS: readonly string[] = [
  'GCP_PROJECT_ID',
  'GCP_REGION',
  'GCP_SERVICE_ACCOUNT',
  'GCP_API_RUNTIME_SERVICE_ACCOUNT',
  'GCP_WIF_PROVIDER',
];

/** The production-environment variables the deploy reads. */
const EXPECTED_ENVIRONMENT_VARS: readonly string[] = [
  'API_URL',
  'WEB_URL',
  'ADMIN_URL',
  'PASSKEY_RP_ID',
  'BETTER_AUTH_ALLOWED_HOSTS',
  'GOOGLE_OAUTH_PUBLIC',
  'API_SECRET_BINDINGS',
];

/** Record a check from a set-difference, naming what is absent — or that nothing could be read. */
function missingCheck(
  name: string,
  expected: readonly string[],
  actual: readonly string[] | null,
  satisfied: string,
): DoctorCheck {
  if (actual === null) {
    return { name, status: 'unknown', detail: 'could not read — check credentials' };
  }
  const have = new Set(actual);
  const missing = expected.filter((item) => !have.has(item));
  return missing.length === 0
    ? { name, status: 'pass', detail: satisfied }
    : { name, status: 'fail', detail: `missing: ${missing.join(', ')}` };
}

/**
 * Compare an observation against what bootstrap provisions.
 *
 * @remarks
 * Pure. Expectations come from `bootstrap.ts`'s own exported constants, so adding an API or a role
 * there is automatically something this reports on.
 *
 * @param observation - Live state.
 * @returns every check, passing and failing, so a clean project prints its clean bill.
 */
function runtimeAccountCheck(actual: string | null, expected: string): DoctorCheck {
  // The deploy passes `--service-account` only when the repository variable exists, so an unset
  // variable silently leaves the API on the project's shared, broadly privileged default compute
  // account. Nothing else would report that.
  const name = 'API runs as its own account';
  if (actual === null) return { name, status: 'unknown', detail: 'could not read Cloud Run' };
  return actual === expected
    ? { name, status: 'pass', detail: expected }
    : { name, status: 'fail', detail: `runs as ${actual}, expected ${expected}` };
}

export function diagnose(observation: Observation): DoctorReport {
  const deploySa = `${SA_NAME}@${observation.project}.iam.gserviceaccount.com`;
  const runtimeSa = `${API_RUNTIME_SA_NAME}@${observation.project}.iam.gserviceaccount.com`;

  const checks: DoctorCheck[] = [
    missingCheck('APIs enabled', REQUIRED_GCP_APIS, observation.enabledApis, 'all enabled'),
    missingCheck(
      'Service accounts',
      [deploySa, runtimeSa],
      observation.serviceAccounts,
      'both exist',
    ),
    missingCheck(
      'Deploy account roles',
      DEPLOY_SA_ROLES,
      observation.projectRoles[deploySa] ?? [],
      'all bound',
    ),
    missingCheck(
      'Runtime account roles',
      API_RUNTIME_SA_ROLES,
      observation.projectRoles[runtimeSa] ?? [],
      'all bound',
    ),
    missingCheck(
      'Runtime account org role',
      [API_RUNTIME_ORG_ROLE],
      observation.orgRoles,
      'bound — operator SSO can resolve groups',
    ),
    missingCheck('Artifact Registry', [AR_REPO], observation.artifactRepos, 'repository exists'),
    missingCheck('Workload Identity pool', [WIF_POOL], observation.wifPools, 'pool exists'),
    missingCheck(
      'Workload Identity provider',
      [WIF_PROVIDER],
      observation.wifProviders,
      'provider exists',
    ),
    missingCheck('Repository variables', EXPECTED_REPO_VARS, observation.repoVars, 'all present'),
    missingCheck(
      'Production environment variables',
      EXPECTED_ENVIRONMENT_VARS,
      observation.environmentVars,
      'all present',
    ),
    runtimeAccountCheck(observation.apiRuntimeServiceAccount, runtimeSa),
  ];

  return {
    project: observation.project,
    // Unknowns are reported, not failed: a credential problem is not drift, and treating it as
    // drift would block a deploy while naming the wrong cause.
    passed: checks.every((check) => check.status !== 'fail'),
    checks,
  };
}

/**
 * Run a read-only command, yielding null when it fails.
 *
 * @remarks
 * Null rather than '' so a command that could not run is distinguishable from one that ran and
 * found nothing. Collapsing the two is what made an expired token report every variable as absent.
 */
function read(args: readonly string[]): string | null {
  try {
    return execFileSync(args[0] ?? '', args.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** Split a gcloud `value(...)` listing into non-empty lines, preserving an unreadable null. */
function lines(output: string | null): string[] | null {
  if (output === null) return null;
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The organization a project sits under, or null — the parent may be a folder, or absent. */
function organizationOf(project: string): string | null {
  const ancestors = read([
    'gcloud',
    'projects',
    'get-ancestors',
    project,
    '--format=value(id,type)',
  ]);
  if (ancestors === null) return null;
  for (const row of ancestors.split('\n')) {
    const [id, type] = row.trim().split(/\s+/);
    if (type === 'organization' && id) return id;
  }
  return null;
}

/** Read every input {@link diagnose} compares. */
function observe(project: string, region: string, repo: string): Observation {
  const scope = [`--project=${project}`];
  const deploySa = `${SA_NAME}@${project}.iam.gserviceaccount.com`;
  const runtimeSa = `${API_RUNTIME_SA_NAME}@${project}.iam.gserviceaccount.com`;

  const rolesFor = (member: string): string[] | null =>
    lines(
      read([
        'gcloud',
        'projects',
        'get-iam-policy',
        project,
        '--flatten=bindings[].members',
        `--filter=bindings.members:${member}`,
        '--format=value(bindings.role)',
      ]),
    );

  // `parent.id` is the immediate parent, which is a FOLDER for a project nested under one — the
  // org role would then be looked for on the folder and reported missing though it is bound.
  const orgId = organizationOf(project);

  return {
    project,
    enabledApis: lines(
      read(['gcloud', 'services', 'list', '--enabled', ...scope, '--format=value(config.name)']),
    ),
    serviceAccounts: lines(
      read(['gcloud', 'iam', 'service-accounts', 'list', ...scope, '--format=value(email)']),
    ),
    projectRoles: { [deploySa]: rolesFor(deploySa), [runtimeSa]: rolesFor(runtimeSa) },
    orgRoles: orgId
      ? lines(
          read([
            'gcloud',
            'organizations',
            'get-iam-policy',
            orgId,
            '--flatten=bindings[].members',
            `--filter=bindings.members:${runtimeSa}`,
            '--format=value(bindings.role)',
          ]),
        )
      : [],
    artifactRepos:
      lines(
        read([
          'gcloud',
          'artifacts',
          'repositories',
          'list',
          `--location=${region}`,
          ...scope,
          '--format=value(name)',
        ]),
      )?.map((name) => name.split('/').pop() ?? name) ?? null,
    wifPools:
      lines(
        read([
          'gcloud',
          'iam',
          'workload-identity-pools',
          'list',
          '--location=global',
          ...scope,
          '--format=value(name)',
        ]),
      )?.map((name) => name.split('/').pop() ?? name) ?? null,
    wifProviders:
      lines(
        read([
          'gcloud',
          'iam',
          'workload-identity-pools',
          'providers',
          'list',
          '--location=global',
          `--workload-identity-pool=${WIF_POOL}`,
          ...scope,
          '--format=value(name)',
        ]),
      )?.map((name) => name.split('/').pop() ?? name) ?? null,
    repoVars: lines(
      read(['gh', 'variable', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name']),
    ),
    environmentVars: lines(
      read([
        'gh',
        'variable',
        'list',
        '--repo',
        repo,
        '--env',
        'production',
        '--json',
        'name',
        '--jq',
        '.[].name',
      ]),
    ),
    apiRuntimeServiceAccount: read([
      'gcloud',
      'run',
      'services',
      'describe',
      'docket-api',
      `--region=${region}`,
      ...scope,
      '--format=value(spec.template.spec.serviceAccountName)',
    ]),
  };
}

function main(): void {
  const project = process.env['GCP_PROJECT_ID'] ?? '';
  const region = process.env['GCP_REGION'] ?? 'us-central1';
  const repo = process.env['GITHUB_REPOSITORY'] ?? '';
  if (!project || !repo) {
    console.error('Set GCP_PROJECT_ID and GITHUB_REPOSITORY (owner/repo).');
    process.exit(2);
  }

  const report = diagnose(observe(project, region, repo));
  for (const check of report.checks) {
    console.log(`${check.status.toUpperCase()}\t${check.name}\t${check.detail}`);
  }

  const unknown = report.checks.filter((check) => check.status === 'unknown').length;
  if (unknown > 0) {
    console.error(`\n${unknown} check(s) could not run — that is a credential problem, not drift.`);
  }
  if (report.passed) {
    console.log(`\n✓ ${report.project} matches what bootstrap provisions.`);
    return;
  }
  console.error(`\n✗ ${report.project} has drifted. Re-run \`pnpm bootstrap\` to reconcile.`);
  process.exit(1);
}

if (process.argv[1]?.endsWith('doctor.ts')) main();
