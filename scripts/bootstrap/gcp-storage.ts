import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cacheConfig } from '../../apps/turbo-cache/src/config';

/** R2 storage and the native Worker endpoint used by the shared Studio cache. */
export const TURBO_CACHE_BUCKET = cacheConfig.bucketName;
export const TURBO_CACHE_URL = cacheConfig.bindings.OIDC_AUDIENCE;
/** Identity CI and local operators impersonate to authenticate to the cache Worker. */
export const TURBO_CACHE_CLIENT = 'docket-turbo-cache-client';
/** Client-only signing-key distribution for local operators; the Worker never reads it. */
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

/** Reuse the dedicated client identity without provisioning a Google cache runtime. */
function ensureCacheClient(cfg: StorageBootstrapConfig, command: StorageCommand): void {
  const existing = resourceNames(
    command('gcloud', [
      'iam',
      'service-accounts',
      'list',
      `--project=${cfg.project}`,
      '--format=value(email)',
    ]),
  );
  for (const name of [TURBO_CACHE_CLIENT]) {
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

/** Preserve client signing bytes and distribute the existing operator key to GitHub. */
function ensureClientSigningKey(cfg: StorageBootstrapConfig, command: StorageCommand): void {
  const secrets = resourceNames(
    command('gcloud', ['secrets', 'list', `--project=${cfg.project}`, '--format=value(name)']),
  );
  if (!secrets.has(TURBO_CACHE_SIGNING_SECRET)) {
    const githubSecrets = JSON.parse(
      command('gh', ['secret', 'list', '--repo', cfg.repo, '--json', 'name']),
    ) as { name: string }[];
    // GitHub values cannot be read back: preserve an existing key rather than replacing it.
    if (githubSecrets.some(({ name }) => name === 'TURBO_REMOTE_CACHE_SIGNATURE_KEY')) return;
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
  const key = command('gcloud', [
    'secrets',
    'versions',
    'access',
    'latest',
    `--secret=${TURBO_CACHE_SIGNING_SECRET}`,
    `--project=${cfg.project}`,
  ]);
  if (key === '') throw new Error('The cache signing key is empty');
  command('gh', ['secret', 'set', 'TURBO_REMOTE_CACHE_SIGNATURE_KEY', '--repo', cfg.repo], key);
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

/**
 * Reconcile private API artifacts and the client identity for the Studio R2 cache.
 * The cache Worker and its R2 binding deploy through the native Cloudflare configuration;
 * this Google foundation never creates a second cache server or storage credentials.
 * @param cfg The production project and existing WIF foundation.
 * @param command Native process boundary, injectable for infrastructure contract checks.
 * @returns Non-secret bucket, endpoint and client identity configuration.
 */
export function setupDocketStorage(
  cfg: StorageBootstrapConfig,
  command: StorageCommand = nativeCommand,
): StorageBootstrapResult {
  const artifactBucket = `${cfg.project}-docket-artifacts`;
  const client = `${TURBO_CACHE_CLIENT}@${cfg.project}.iam.gserviceaccount.com`;
  ensureBucket(cfg, artifactBucket, cfg.apiRuntimeSaEmail, command);
  ensureCacheClient(cfg, command);
  configureCacheIdentity(cfg, client, command);
  ensureClientSigningKey(cfg, command);
  return {
    artifactBucket,
    cacheBucket: TURBO_CACHE_BUCKET,
    cacheClientSaEmail: client,
    cacheUrl: TURBO_CACHE_URL,
  };
}
