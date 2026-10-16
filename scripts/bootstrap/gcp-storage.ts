import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Maintained upstream cache server, pinned to the verified 2.14.3 image index. */
export const TURBO_CACHE_IMAGE =
  'docker.io/ducktors/turborepo-remote-cache@sha256:781b0549dca80cf5aca27bf416fc766d44cad57333a7368098a755c5f12b8822';
/** Dedicated IAM-protected cache service and runtime identity. */
export const TURBO_CACHE_SERVICE = 'docket-turbo-cache';
/** Identity CI and local operators impersonate to invoke the cache. */
export const TURBO_CACHE_CLIENT = 'docket-turbo-cache-client';
/** HMAC key shared by Turbo clients and the cache server. */
export const TURBO_CACHE_SIGNING_SECRET = 'docket-turbo-cache-signing-key';

/** Existing production foundation used to provision Docket's private storage. */
export interface StorageBootstrapConfig {
  readonly project: string;
  readonly projectNumber: string;
  readonly region: string;
  readonly repo: string;
  readonly wifPool: string;
  readonly apiRuntimeSaEmail: string;
}

/** Non-secret resource addresses published to GitHub after setup. */
export interface StorageBootstrapResult {
  readonly artifactBucket: string;
  readonly cacheBucket: string;
  readonly cacheClientSaEmail: string;
  readonly cacheUrl: string;
}

/** Native CLI boundary; sensitive input is sent on stdin, never in argument strings. */
export type StorageCommand = (file: string, args: readonly string[], input?: string) => string;

/** Capture native output so signing keys never reach bootstrap logs or temporary files. */
function nativeCommand(file: string, args: readonly string[], input?: string): string {
  return execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', input }).trim();
}

/** Normalize resource-list output without treating permission failures as missing resources. */
function resourceNames(value: string): Set<string> {
  return new Set(
    value
      .split('\n')
      .map((name) => name.trim().replace(/\/$/, '').split('/').at(-1) ?? '')
      .filter(Boolean),
  );
}

/** Create each dedicated cache account only when it is absent. */
function ensureCacheAccounts(cfg: StorageBootstrapConfig, command: StorageCommand): void {
  const existing = resourceNames(
    command('gcloud', [
      'iam',
      'service-accounts',
      'list',
      `--project=${cfg.project}`,
      '--format=value(email)',
    ]),
  );
  for (const name of [TURBO_CACHE_SERVICE, TURBO_CACHE_CLIENT]) {
    if (!existing.has(`${name}@${cfg.project}.iam.gserviceaccount.com`)) {
      command('gcloud', [
        'iam',
        'service-accounts',
        'create',
        name,
        `--project=${cfg.project}`,
        `--display-name=${name}`,
      ]);
    }
  }
}

/** Reconcile private bucket settings and grant access only on that bucket. */
function ensureBucket(
  cfg: StorageBootstrapConfig,
  bucket: string,
  account: string,
  command: StorageCommand,
): void {
  const existing = resourceNames(
    command('gcloud', [
      'storage',
      'buckets',
      'list',
      `--project=${cfg.project}`,
      '--format=value(name)',
    ]),
  );
  const privacy = [
    '--uniform-bucket-level-access',
    '--public-access-prevention',
    '--soft-delete-duration=0',
  ];
  if (!existing.has(bucket)) {
    command('gcloud', [
      'storage',
      'buckets',
      'create',
      `gs://${bucket}`,
      `--project=${cfg.project}`,
      `--location=${cfg.region}`,
      '--default-storage-class=STANDARD',
      ...privacy,
    ]);
  } else {
    command('gcloud', [
      'storage',
      'buckets',
      'update',
      `gs://${bucket}`,
      `--project=${cfg.project}`,
      ...privacy,
    ]);
  }
  command('gcloud', [
    'storage',
    'buckets',
    'add-iam-policy-binding',
    `gs://${bucket}`,
    `--project=${cfg.project}`,
    `--member=serviceAccount:${account}`,
    '--role=roles/storage.objectUser',
    '--condition=None',
    '--quiet',
  ]);
}

/** Apply age cleanup only to the disposable cache bucket using gcloud's lifecycle format. */
function configureCacheLifecycle(
  cfg: StorageBootstrapConfig,
  bucket: string,
  command: StorageCommand,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'docket-cache-lifecycle-'));
  const path = join(directory, 'lifecycle.json');
  try {
    writeFileSync(
      path,
      JSON.stringify({ rule: [{ action: { type: 'Delete' }, condition: { age: 14 } }] }),
      { mode: 0o600 },
    );
    command('gcloud', [
      'storage',
      'buckets',
      'update',
      `gs://${bucket}`,
      `--project=${cfg.project}`,
      `--lifecycle-file=${path}`,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Retain an existing key, synchronize its pinned version to GitHub, and scope server access. */
function configureSigningKey(
  cfg: StorageBootstrapConfig,
  runtimeAccount: string,
  command: StorageCommand,
): string {
  const existing = resourceNames(
    command('gcloud', ['secrets', 'list', `--project=${cfg.project}`, '--format=value(name)']),
  );
  if (!existing.has(TURBO_CACHE_SIGNING_SECRET)) {
    command(
      'gcloud',
      [
        'secrets',
        'create',
        TURBO_CACHE_SIGNING_SECRET,
        `--project=${cfg.project}`,
        '--replication-policy=automatic',
        '--data-file=-',
      ],
      randomBytes(32).toString('hex'),
    );
  }
  const version =
    command('gcloud', [
      'secrets',
      'versions',
      'describe',
      'latest',
      `--secret=${TURBO_CACHE_SIGNING_SECRET}`,
      `--project=${cfg.project}`,
      '--format=value(name)',
    ])
      .split('/')
      .at(-1) ?? '';
  if (!/^\d+$/.test(version)) throw new Error('Could not resolve the cache signing key version');
  const key = command('gcloud', [
    'secrets',
    'versions',
    'access',
    version,
    `--secret=${TURBO_CACHE_SIGNING_SECRET}`,
    `--project=${cfg.project}`,
  ]);
  if (key === '') throw new Error('The cache signing key is empty');
  command('gh', ['secret', 'set', 'TURBO_REMOTE_CACHE_SIGNATURE_KEY', '--repo', cfg.repo], key);
  command('gcloud', [
    'secrets',
    'add-iam-policy-binding',
    TURBO_CACHE_SIGNING_SECRET,
    `--project=${cfg.project}`,
    `--member=serviceAccount:${runtimeAccount}`,
    '--role=roles/secretmanager.secretAccessor',
    '--condition=None',
    '--quiet',
  ]);
  return version;
}

/** Give GitHub main and the active operator permission to impersonate only the cache client. */
function configureCacheIdentity(
  cfg: StorageBootstrapConfig,
  client: string,
  command: StorageCommand,
): void {
  const subject = `principal://iam.googleapis.com/projects/${cfg.projectNumber}/locations/global/workloadIdentityPools/${cfg.wifPool}/subject/repo:${cfg.repo}:ref:refs/heads/main`;
  const binding = [
    'iam',
    'service-accounts',
    'add-iam-policy-binding',
    client,
    `--project=${cfg.project}`,
    '--condition=None',
    '--quiet',
  ];
  command('gcloud', [...binding, '--role=roles/iam.workloadIdentityUser', `--member=${subject}`]);
  const operator = command('gcloud', [
    'auth',
    'list',
    '--filter=status:ACTIVE',
    '--format=value(account)',
  ]);
  if (operator === '' || operator.includes('\n'))
    throw new Error('Select one active gcloud account before cache setup');
  const kind = operator.endsWith('.gserviceaccount.com') ? 'serviceAccount' : 'user';
  command('gcloud', [
    ...binding,
    '--role=roles/iam.serviceAccountTokenCreator',
    `--member=${kind}:${operator}`,
  ]);
}

/** Remove service-level public invoker bindings without replacing the rest of its IAM policy. */
function removePublicInvokers(cfg: StorageBootstrapConfig, command: StorageCommand): void {
  const policy = JSON.parse(
    command('gcloud', [
      'run',
      'services',
      'get-iam-policy',
      TURBO_CACHE_SERVICE,
      `--project=${cfg.project}`,
      `--region=${cfg.region}`,
      '--format=json',
    ]),
  ) as {
    bindings?: { role: string; members?: string[] }[];
  };
  for (const binding of policy.bindings ?? []) {
    if (binding.role !== 'roles/run.invoker') continue;
    for (const member of binding.members ?? []) {
      if (member === 'allUsers' || member === 'allAuthenticatedUsers') {
        command('gcloud', [
          'run',
          'services',
          'remove-iam-policy-binding',
          TURBO_CACHE_SERVICE,
          `--project=${cfg.project}`,
          `--region=${cfg.region}`,
          `--member=${member}`,
          '--role=roles/run.invoker',
          '--condition=None',
          '--quiet',
        ]);
      }
    }
  }
}

/**
 * Provision private API artifacts and a signed upstream Turbo cache through native provider CLIs.
 * Existing resources and signing keys are reused; provider failures stop setup rather than
 * selecting a public endpoint or replacing application storage with a local fallback.
 * @param cfg The production project and existing WIF foundation.
 * @param command Native process boundary, injectable for infrastructure contract checks.
 * @returns Non-secret bucket, endpoint and client identity configuration.
 */
export function setupDocketStorage(
  cfg: StorageBootstrapConfig,
  command: StorageCommand = nativeCommand,
): StorageBootstrapResult {
  const artifactBucket = `${cfg.project}-docket-artifacts`;
  const cacheBucket = `${cfg.project}-docket-turbo-cache`;
  const runtime = `${TURBO_CACHE_SERVICE}@${cfg.project}.iam.gserviceaccount.com`;
  const client = `${TURBO_CACHE_CLIENT}@${cfg.project}.iam.gserviceaccount.com`;
  ensureCacheAccounts(cfg, command);
  ensureBucket(cfg, artifactBucket, cfg.apiRuntimeSaEmail, command);
  ensureBucket(cfg, cacheBucket, runtime, command);
  configureCacheLifecycle(cfg, cacheBucket, command);
  const signingVersion = configureSigningKey(cfg, runtime, command);
  configureCacheIdentity(cfg, client, command);
  command('gcloud', [
    'run',
    'deploy',
    TURBO_CACHE_SERVICE,
    `--project=${cfg.project}`,
    `--region=${cfg.region}`,
    `--image=${TURBO_CACHE_IMAGE}`,
    `--service-account=${runtime}`,
    '--no-allow-unauthenticated',
    '--invoker-iam-check',
    '--use-http2',
    '--port=3000',
    '--min=0',
    '--max=1',
    '--cpu-throttling',
    '--cpu=1',
    '--memory=512Mi',
    '--timeout=300',
    `--set-env-vars=AUTH_MODE=none,STORAGE_PROVIDER=google-cloud-storage,STORAGE_PATH=${cacheBucket},HTTP2=true,BODY_LIMIT=1073741824`,
    `--set-secrets=TURBO_REMOTE_CACHE_SIGNATURE_KEY=${TURBO_CACHE_SIGNING_SECRET}:${signingVersion}`,
    '--quiet',
  ]);
  removePublicInvokers(cfg, command);
  command('gcloud', [
    'run',
    'services',
    'add-iam-policy-binding',
    TURBO_CACHE_SERVICE,
    `--project=${cfg.project}`,
    `--region=${cfg.region}`,
    `--member=serviceAccount:${client}`,
    '--role=roles/run.invoker',
    '--condition=None',
    '--quiet',
  ]);
  const cacheUrl = command('gcloud', [
    'run',
    'services',
    'describe',
    TURBO_CACHE_SERVICE,
    `--project=${cfg.project}`,
    `--region=${cfg.region}`,
    '--format=value(status.url)',
  ]);
  if (!cacheUrl.startsWith('https://'))
    throw new Error('The Turbo cache service has no HTTPS endpoint');
  return { artifactBucket, cacheBucket, cacheClientSaEmail: client, cacheUrl };
}
