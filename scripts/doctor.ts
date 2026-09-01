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
import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import {
  API_RUNTIME_ORG_ROLE,
  API_RUNTIME_SA_NAME,
  API_RUNTIME_SA_ROLES,
  AR_REPO,
  DEPLOY_SA_ROLES,
  PRODUCTION_VAR_NAMES,
  REPO_VAR_NAMES,
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
      observation.projectRoles[deploySa] ?? null,
      'all bound',
    ),
    missingCheck(
      'Runtime account roles',
      API_RUNTIME_SA_ROLES,
      observation.projectRoles[runtimeSa] ?? null,
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
    missingCheck('Repository variables', REPO_VAR_NAMES, observation.repoVars, 'all present'),
    missingCheck(
      'Production environment variables',
      [...PRODUCTION_VAR_NAMES, 'API_SECRET_BINDINGS'],
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
 * `execFile` as a promise.
 *
 * @remarks
 * Node has no promise-native `child_process` — there is no `child_process/promises`, and the
 * module exposes no promises namespace (checked on 24.17). `execFile` instead ships a
 * `util.promisify.custom` implementation, which exists precisely so this call returns the
 * `{ stdout, stderr }` shape rather than a bare callback result. This is the supported path, not
 * a legacy shim.
 */
const run = promisify(execFile);

/**
 * Run a read-only command, yielding null when it fails.
 *
 * @remarks
 * Null rather than '' so a command that could not run is distinguishable from one that ran and
 * found nothing. Collapsing the two is what made an expired token report every variable as absent.
 *
 * Async so the reads can overlap. Every check here is an independent network round trip of a
 * second or more, and running eleven of them in sequence made a command whose whole job is to
 * print a table take about as long as reading the table would.
 */
async function read(args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await run(args[0] ?? '', args.slice(1), {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim();
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

/**
 * The organization a project sits under.
 *
 * @remarks
 * Three outcomes, and they are not the same: the org id, `''` for a project genuinely outside an
 * organization, and null when the ancestry could not be read at all.
 */
async function organizationOf(project: string): Promise<string | null> {
  const ancestors = await read([
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
  return '';
}

/** Read every input {@link diagnose} compares. */
/** Strip a gcloud resource path down to its trailing id, preserving an unreadable null. */
function ids(output: string | null): string[] | null {
  return lines(output)?.map((name) => name.split('/').pop() ?? name) ?? null;
}

/**
 * Read every input {@link diagnose} compares.
 *
 * @remarks
 * The reads are independent network round trips, so they overlap rather than queue — sequentially
 * this took about as long as a human would take to check by hand. Only the organization role
 * depends on anything (the org id), which is why it is a second round rather than part of the fan-out.
 */
async function observe(project: string, region: string, repo: string): Promise<Observation> {
  const scope = [`--project=${project}`];
  const deploySa = `${SA_NAME}@${project}.iam.gserviceaccount.com`;
  const runtimeSa = `${API_RUNTIME_SA_NAME}@${project}.iam.gserviceaccount.com`;

  const rolesFor = (member: string): Promise<string | null> =>
    read([
      'gcloud',
      'projects',
      'get-iam-policy',
      project,
      '--flatten=bindings[].members',
      `--filter=bindings.members:${member}`,
      '--format=value(bindings.role)',
    ]);

  const [
    enabledApis,
    serviceAccounts,
    deployRoles,
    runtimeRoles,
    artifactRepos,
    wifPools,
    wifProviders,
    repoVars,
    environmentVars,
    apiRuntimeServiceAccount,
    // `parent.id` is the immediate parent, which is a FOLDER for a project nested under one — the
    // org role would then be looked for on the folder and reported missing though it is bound.
    orgId,
  ] = await Promise.all([
    read(['gcloud', 'services', 'list', '--enabled', ...scope, '--format=value(config.name)']),
    read(['gcloud', 'iam', 'service-accounts', 'list', ...scope, '--format=value(email)']),
    rolesFor(deploySa),
    rolesFor(runtimeSa),
    read([
      'gcloud',
      'artifacts',
      'repositories',
      'list',
      `--location=${region}`,
      ...scope,
      '--format=value(name)',
    ]),
    read([
      'gcloud',
      'iam',
      'workload-identity-pools',
      'list',
      '--location=global',
      ...scope,
      '--format=value(name)',
    ]),
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
    read(['gh', 'variable', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name']),
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
    read([
      'gcloud',
      'run',
      'services',
      'describe',
      'docket-api',
      `--region=${region}`,
      ...scope,
      '--format=value(spec.template.spec.serviceAccountName)',
    ]),
    organizationOf(project),
  ]);

  // A null orgId means the lookup FAILED; a project genuinely outside an organization is the
  // empty-string case. Collapsing both to [] would print "missing: roles/cloudidentity.groupsReader"
  // for what is really a credential problem — the outcome `unknown` exists to prevent.
  const orgRoles =
    orgId === null
      ? null
      : orgId === ''
        ? []
        : lines(
            await read([
              'gcloud',
              'organizations',
              'get-iam-policy',
              orgId,
              '--flatten=bindings[].members',
              `--filter=bindings.members:${runtimeSa}`,
              '--format=value(bindings.role)',
            ]),
          );

  return {
    project,
    enabledApis: lines(enabledApis),
    serviceAccounts: lines(serviceAccounts),
    projectRoles: { [deploySa]: lines(deployRoles), [runtimeSa]: lines(runtimeRoles) },
    orgRoles,
    artifactRepos: ids(artifactRepos),
    wifPools: ids(wifPools),
    wifProviders: ids(wifProviders),
    repoVars: lines(repoVars),
    environmentVars: lines(environmentVars),
    apiRuntimeServiceAccount,
  };
}

async function main(): Promise<void> {
  const project = process.env['GCP_PROJECT_ID'] ?? '';
  const region = process.env['GCP_REGION'] ?? 'us-central1';
  const repo = process.env['GITHUB_REPOSITORY'] ?? '';
  if (!project || !repo) {
    console.error('Set GCP_PROJECT_ID and GITHUB_REPOSITORY (owner/repo).');
    process.exit(2);
  }

  const report = diagnose(await observe(project, region, repo));
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

if (process.argv[1]?.endsWith('doctor.ts')) await main();
