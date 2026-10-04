import { execFileSync } from 'node:child_process';
import {
  acceptanceTargets,
  runtimeSecretBindings,
  servingRevision,
} from './lattice-acceptance-report';

/** Capture bounded gcloud output without printing provider errors. */
export function gcloud(args: string[], preserveWhitespace = false): string {
  const output = execFileSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return preserveWhitespace ? output : output.trim();
}

function mask(value: string): void {
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    process.stdout.write(`::add-mask::${escaped}\n`);
  }
}

/** Resolve the sole serving revision and its secret references for a fixed audit environment. */
export function runtime(target: string): ReturnType<typeof runtimeSecretBindings> {
  acceptanceTargets(target);
  const service = target === 'production' ? 'docket-api' : 'docket-api-staging';
  const serviceDescription: unknown = JSON.parse(
    gcloud([
      'run',
      'services',
      'describe',
      service,
      '--project=athena-services',
      '--region=us-central1',
      '--format=json(status)',
    ]),
  );
  const revision = servingRevision(serviceDescription);
  const revisionDescription = JSON.parse(
    gcloud([
      'run',
      'revisions',
      'describe',
      revision,
      '--project=athena-services',
      '--region=us-central1',
      '--format=json(spec.containers)',
    ]),
  ) as { spec?: unknown };
  const deployed = runtimeSecretBindings(serviceDescription);
  return runtimeSecretBindings({
    status: { latestReadyRevisionName: revision, url: deployed.url },
    spec: { template: { spec: revisionDescription.spec } },
  });
}

/** Read one deployed secret into memory and register its value with runner masking. */
export function boundSecret(deployed: ReturnType<typeof runtime>, environmentName: string): string {
  const binding = deployed.bindings.find(
    (candidate) => candidate.environmentName === environmentName,
  );
  if (!binding) throw new Error(`Missing deployed binding: ${environmentName}`);
  const value = gcloud(
    [
      'secrets',
      'versions',
      'access',
      binding.version,
      `--secret=${binding.secretName}`,
      '--project=athena-services',
      '--quiet',
    ],
    true,
  );
  mask(value);
  return value;
}
