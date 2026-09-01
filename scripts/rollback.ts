/**
 * Send production traffic back to a known-good Cloud Run revision.
 *
 * @remarks
 * `docs/engineering/deployment.md` states the policy — *"Never roll production schema backward
 * during an application rollback; route traffic to the prior compatible revision instead"* — and
 * has never carried a command for it. During an incident that leaves the operator composing gcloud
 * flags from memory, which is when a typo costs the most.
 *
 * Schema is deliberately untouched. Migrations are additive by policy precisely so the previous
 * revision keeps working against the newer schema, which is what makes a traffic-only rollback the
 * correct move rather than a partial one.
 *
 * Usage:
 *   `tsx scripts/rollback.ts --service docket-api` — list revisions with their traffic split
 *   `tsx scripts/rollback.ts --service docket-api --to <revision>` — send 100% there
 *   add `--dry-run` to print the command without running it
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

/** One Cloud Run revision, as the rollback view needs it. */
export interface Revision {
  /** Revision name, e.g. `docket-api-00233-s9z`. */
  readonly name: string;
  /** Percentage of traffic currently served, 0 when none. */
  readonly trafficPercent: number;
  /** Whether the revision is serving and healthy. */
  readonly ready: boolean;
  /** ISO creation timestamp, newest first when listed. */
  readonly createdAt: string;
}

/** What a rollback would do, decided before anything is executed. */
export type RollbackPlan =
  | { readonly kind: 'rollback'; readonly service: string; readonly to: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Decide whether a requested rollback is safe to run.
 *
 * @remarks
 * Pure, so the refusals are testable without touching a live project — the same split
 * `validateSecretBindings` and `evaluateBillingRuntimeRollout` use. Every refusal is a mistake an
 * operator can plausibly make at 3am: naming a revision that does not exist, naming one that never
 * became ready, or rolling back to the revision already serving.
 *
 * @param revisions - Every revision of the service.
 * @param to - The revision the operator asked for.
 * @param service - The Cloud Run service name, echoed into the plan.
 * @returns the plan to execute, or a refusal explaining why not.
 */
export function planRollback(
  revisions: readonly Revision[],
  to: string,
  service: string,
): RollbackPlan {
  const target = revisions.find((revision) => revision.name === to);
  if (!target) {
    return { kind: 'refused', reason: `no revision named ${to} on ${service}` };
  }
  if (!target.ready) {
    // A revision that never became ready is not a known-good state to return to; rolling into it
    // would replace one outage with another and lose the revision that is at least still serving.
    return { kind: 'refused', reason: `${to} never became ready — it is not a good state` };
  }
  if (target.trafficPercent === 100) {
    return { kind: 'refused', reason: `${to} already serves all traffic` };
  }
  return { kind: 'rollback', service, to };
}

/** How many revisions back a rollback realistically reaches. */
const REVISION_WINDOW = 20;

/** Run a gcloud command, reporting its own words on failure rather than a stack trace. */
function gcloud(args: readonly string[], what: string): string {
  try {
    return execFileSync('gcloud', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error(`✗ could not ${what}.`);
    console.error('  Check `gcloud config get-value account` administers this project.\n');
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    console.error(stderr ? String(stderr).trim() : (error as Error).message);
    process.exit(1);
  }
}

/**
 * Read the service's revisions, newest first, with the traffic split applied.
 *
 * @remarks
 * Traffic lives on the SERVICE, not on a revision — a revision object carries no split at all, so
 * reading it there reports every revision as serving nothing and the "already serving" refusal
 * never fires. Two small reads, and only the fields this needs: the unprojected revision list is
 * megabytes once a service has a couple of hundred revisions, which overruns the subprocess buffer
 * outright.
 */
function readRevisions(service: string, region: string, project: string): Revision[] {
  const scope = [`--region=${region}`, `--project=${project}`];

  const traffic = new Map<string, number>();
  const serviceJson = JSON.parse(
    gcloud(
      ['run', 'services', 'describe', service, ...scope, '--format=json(status.traffic)'],
      `read the traffic split for ${service}`,
    ),
  ) as { status?: { traffic?: { revisionName?: string; percent?: number }[] } };
  for (const split of serviceJson.status?.traffic ?? []) {
    if (split.revisionName) traffic.set(split.revisionName, split.percent ?? 0);
  }

  const revisionsJson = JSON.parse(
    gcloud(
      [
        'run',
        'revisions',
        'list',
        `--service=${service}`,
        ...scope,
        `--limit=${REVISION_WINDOW}`,
        '--sort-by=~metadata.creationTimestamp',
        '--format=json(metadata.name,metadata.creationTimestamp,status.conditions)',
      ],
      `list revisions of ${service}`,
    ),
  ) as {
    metadata?: { name?: string; creationTimestamp?: string };
    status?: { conditions?: { type?: string; status?: string }[] };
  }[];

  return revisionsJson.map((revision) => {
    const name = revision.metadata?.name ?? '';
    return {
      name,
      createdAt: revision.metadata?.creationTimestamp ?? '',
      ready:
        revision.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ??
        false,
      trafficPercent: traffic.get(name) ?? 0,
    };
  });
}

/** Show what is deployed and what could be rolled back to. */
function printRevisions(service: string, revisions: readonly Revision[]): void {
  console.log(`Revisions of ${service} (newest first):\n`);
  for (const revision of revisions) {
    const serving = revision.trafficPercent > 0 ? `${revision.trafficPercent}% traffic` : '—';
    const state = revision.ready ? 'ready' : 'NOT READY';
    console.log(`  ${revision.name}\t${state}\t${serving}\t${revision.createdAt}`);
  }
  console.log(`\nRoll back with: pnpm rollback --service ${service} --to <revision>`);
}

/** The value of a flag, or undefined. */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const service = flag('service') ?? 'docket-api';
  const region = flag('region') ?? process.env['GCP_REGION'] ?? 'us-central1';
  const project = flag('project') ?? process.env['GCP_PROJECT_ID'] ?? '';
  const dryRun = process.argv.includes('--dry-run');
  const to = flag('to');

  if (!project) {
    console.error('Set GCP_PROJECT_ID or pass --project.');
    process.exit(2);
  }

  const revisions = readRevisions(service, region, project);

  if (!to) {
    printRevisions(service, revisions);
    return;
  }

  const plan = planRollback(revisions, to, service);
  if (plan.kind === 'refused') {
    console.error(`✗ ${plan.reason}`);
    process.exit(1);
  }

  const args = [
    'run',
    'services',
    'update-traffic',
    plan.service,
    `--to-revisions=${plan.to}=100`,
    `--region=${region}`,
    `--project=${project}`,
    '--quiet',
  ];
  if (dryRun) {
    console.log(`gcloud ${args.join(' ')}`);
    return;
  }
  execFileSync('gcloud', args, { stdio: 'inherit' });
  console.log(`\n✓ ${plan.service} now serves ${plan.to}.`);
  console.log('Schema is unchanged by design — migrations are additive, so this is a full revert.');
}

if (process.argv[1]?.endsWith('rollback.ts')) main();
