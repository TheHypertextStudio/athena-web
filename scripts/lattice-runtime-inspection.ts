import { execFileSync } from 'node:child_process';

/** Treat provider JSON as a record without accepting arrays or null. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Runtime references that can be recorded without revealing environment values. */
export interface RuntimeSecretBindings {
  revision: string | null;
  url: string | null;
  bindings: { environmentName: string; secretName: string; version: string }[];
}

function secretBinding(value: unknown): RuntimeSecretBindings['bindings'] {
  const input = record(value);
  const reference = record(record(input['valueFrom'])['secretKeyRef']);
  if (
    typeof input['name'] !== 'string' ||
    typeof reference['name'] !== 'string' ||
    typeof reference['key'] !== 'string'
  )
    return [];
  return [
    { environmentName: input['name'], secretName: reference['name'], version: reference['key'] },
  ];
}

/** Extract deployed secret references while discarding all literal environment values. */
export function runtimeSecretBindings(value: unknown): RuntimeSecretBindings {
  const input = record(value);
  const status = record(input['status']);
  const containers = record(record(record(input['spec'])['template'])['spec'])['containers'];
  const container = record(Array.isArray(containers) ? containers[0] : null);
  const environment = Array.isArray(container['env']) ? container['env'] : [];
  return {
    revision: stringOrNull(status['latestReadyRevisionName']),
    url: stringOrNull(status['url']),
    bindings: environment.flatMap(secretBinding),
  };
}

/**
 * Select the revision actually receiving all traffic, including an explicit older pin.
 * @throws When traffic is split or the serving revision cannot be identified.
 */
export function servingRevision(value: unknown): string {
  const status = record(record(value)['status']);
  const traffic = status['traffic'];
  if (!Array.isArray(traffic)) throw new Error('Serving revision unavailable');
  const receiving = traffic.map(record).filter((entry) => Number(entry['percent']) > 0);
  const route = receiving[0];
  if (receiving.length !== 1 || !route || Number(route['percent']) !== 100) {
    throw new Error('Ambiguous serving revisions');
  }
  const revision = stringOrNull(route['revisionName']);
  if (!revision) throw new Error('Serving revision unavailable');
  return revision;
}

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
  if (target !== 'production' && target !== 'staging') throw new Error('Unknown audit target');
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

const PUBLIC_RUNTIME_ENV = {
  APP_MODE: 'mode',
  API_URL: 'url',
  WEB_URL: 'url',
  ADMIN_URL: 'url',
  BETTER_AUTH_URL: 'url',
  BETTER_AUTH_TRUSTED_ORIGINS: 'origins',
  BETTER_AUTH_ALLOWED_HOSTS: 'hosts',
  BETTER_AUTH_PASSKEY_RP_ID: 'hosts',
  BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'hosts',
  BETTER_AUTH_PASSKEY_NATIVE_ORIGINS: 'origins',
  BETTER_AUTH_COOKIE_DOMAIN: 'hosts',
  OAUTH_PROXY_PRODUCTION_URL: 'url',
  LATTICE_CLIENT_ID: 'url',
  LATTICE_LEGACY_CLIENT_ID: 'url',
  LATTICE_ACCOUNTS_ISSUER: 'url',
  LATTICE_GATEWAY_URL: 'url',
  LATTICE_RESOURCE_URL: 'url',
  PUBLIC_BRIEF_HOST: 'hosts',
  CUSTOM_DOMAIN_CNAME_TARGET: 'hosts',
  ATHENA_ASYNC_RUNNER_ENABLED: 'boolean',
  GOOGLE_OAUTH_PUBLIC: 'boolean',
} as const;

/** Reject overlong or control-bearing literals before syntax-specific projection. */
function publicText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}

/** Validate public configuration syntax before retaining an allowlisted literal. */
function publicLiteral(value: unknown, kind: string): string | null {
  if (!publicText(value)) return null;
  return value === '' ? value : typedPublicLiteral(value, kind);
}

/** Project only syntax approved for the named public configuration category. */
function typedPublicLiteral(value: string, kind: string): string | null {
  if (kind === 'mode')
    return ['local', 'test', 'staging', 'production'].includes(value) ? value : null;
  if (kind === 'boolean') return value === 'true' || value === 'false' ? value : null;
  if (kind === 'hosts')
    return /^(?:\*\.)?\.?[a-z0-9.-]+(?:,(?:\*\.)?\.?[a-z0-9.-]+)*$/.test(value) ? value : null;
  try {
    const entries = kind === 'origins' ? value.split(',') : [value];
    const valid = entries.every((entry) => {
      if (/^android:apk-key-hash:[A-Za-z0-9+/=_-]+$/.test(entry)) return kind === 'origins';
      const url = new URL(entry.trim());
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      );
    });
    return valid ? value : null;
  } catch {
    return null;
  }
}

/** Select only approved nonsecret literals; all other literal values remain unrecorded. */
function publicEnvironment(container: Record<string, unknown>) {
  const entries = Array.isArray(container['env']) ? container['env'].map(record) : [];
  return Object.entries(PUBLIC_RUNTIME_ENV).map(([name, kind]) => {
    const matches = entries.filter((entry) => entry['name'] === name);
    if (matches.length > 1) throw new Error('Duplicate public environment variable');
    const entry = matches[0];
    if (!entry) return { name, status: 'absent', value: null };
    if (entry['valueFrom'] !== undefined) return { name, status: 'secret-reference', value: null };
    const value = publicLiteral(entry['value'], kind);
    return { name, status: value === null ? 'invalid' : 'literal', value };
  });
}

/** Keep only bounded provider identifiers, never arbitrary provider strings. */
function providerIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9_./-]+$/.test(value)) {
    throw new Error('Invalid runtime metadata identifier');
  }
  return value;
}

/** Retain only an image reference in the existing project's container registry. */
function containerImage(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^(?:[a-z0-9-]+-docker\.pkg\.dev|(?:[a-z0-9-]+\.)?gcr\.io)\/athena-services\/[A-Za-z0-9_./:@-]+$/.test(
      value,
    )
  ) {
    throw new Error('Unexpected staging image reference');
  }
  return value;
}

/**
 * Read only the fixed staging service's status and serving revision configuration.
 * @returns Allowlisted nonsecret configuration, image/traffic identity and secret references.
 * @throws For ambiguous traffic, malformed metadata or denied provider access; never reads secrets.
 */
export function stagingRuntimeMetadata() {
  const status = record(
    record(
      JSON.parse(
        gcloud([
          'run',
          'services',
          'describe',
          'docket-api-staging',
          '--project=athena-services',
          '--region=us-central1',
          '--format=json(status)',
        ]),
      ) as unknown,
    )['status'],
  );
  const revision = providerIdentifier(servingRevision({ status }));
  if (!/^docket-api-staging-[a-z0-9-]+$/.test(revision))
    throw new Error('Unexpected staging revision');
  const spec = record(
    record(
      JSON.parse(
        gcloud([
          'run',
          'revisions',
          'describe',
          revision,
          '--project=athena-services',
          '--region=us-central1',
          '--format=json(spec.containers)',
        ]),
      ) as unknown,
    )['spec'],
  );
  const containers = spec['containers'];
  if (!Array.isArray(containers) || containers.length !== 1)
    throw new Error('Unexpected containers');
  const container = record(containers[0]);
  const environment = container['env'];
  if (!Array.isArray(environment) || environment.length > 256)
    throw new Error('Invalid environment');
  const deployed = runtimeSecretBindings({ status, spec: { template: { spec } } });
  if (
    environment.filter((entry: unknown) => record(entry)['valueFrom'] !== undefined).length !==
    deployed.bindings.length
  ) {
    throw new Error('Unrecognized secret reference');
  }
  const bindings = deployed.bindings.map((binding) => ({
    environmentName: providerIdentifier(binding.environmentName),
    secretName: providerIdentifier(binding.secretName),
    version: providerIdentifier(binding.version),
  }));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'metadata-only',
    target: 'staging',
    project: 'athena-services',
    region: 'us-central1',
    service: 'docket-api-staging',
    revision,
    url: publicLiteral(deployed.url, 'url'),
    image: containerImage(container['image']),
    trafficPercent: 100,
    environment: publicEnvironment(container),
    bindings,
  };
}
