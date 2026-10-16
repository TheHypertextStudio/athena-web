import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PRODUCTION_VAR_NAMES, REPO_VAR_NAMES, REQUIRED_GCP_APIS } from '../../scripts/bootstrap';
import {
  setupDocketStorage,
  TURBO_CACHE_IMAGE,
  type StorageCommand,
} from '../../scripts/bootstrap/gcp-storage';
import { assertWritesEveryName } from '../../scripts/bootstrap/github';

const CONFIG = {
  project: 'athena-services',
  projectNumber: '770668668034',
  region: 'us-central1',
  repo: 'TheHypertextStudio/athena-web',
  wifPool: 'github',
  apiRuntimeSaEmail: 'docket-api@athena-services.iam.gserviceaccount.com',
};
const CLIENT = 'docket-turbo-cache-client@athena-services.iam.gserviceaccount.com';
const RUNTIME = 'docket-turbo-cache@athena-services.iam.gserviceaccount.com';

interface Invocation {
  file: string;
  args: readonly string[];
  input: string | undefined;
}

/** Record native operations and return fixture provider state at the subprocess boundary. */
function provider(existing = false): {
  commands: Invocation[];
  lifecycle: { path: string; policy: unknown }[];
  command: StorageCommand;
} {
  const commands: Invocation[] = [];
  const lifecycle: { path: string; policy: unknown }[] = [];
  const responses: Record<string, string> = {
    'iam service-accounts list': existing ? `${CLIENT}\n${RUNTIME}` : '',
    'storage buckets list': existing
      ? 'gs://athena-services-docket-artifacts/\ngs://athena-services-docket-turbo-cache/'
      : '',
    'secrets list --project=athena-services': existing
      ? 'projects/athena-services/secrets/docket-turbo-cache-signing-key'
      : '',
    'secrets versions describe':
      'projects/athena-services/secrets/docket-turbo-cache-signing-key/versions/7',
    'secrets versions access': 'fixture-signing-key',
    'auth list --filter=status:ACTIVE': 'operator@example.com',
    'run services get-iam-policy': JSON.stringify({
      bindings: [
        {
          role: 'roles/run.invoker',
          members: ['allUsers', 'allAuthenticatedUsers', 'serviceAccount:existing@example.com'],
        },
      ],
    }),
    'run services describe': 'https://docket-turbo-cache.example.run.app',
  };
  const command: StorageCommand = (file, args, input) => {
    commands.push({ file, args, input });
    const operation = args.slice(0, 3).join(' ');
    const lifecycleFile = args.find((arg) => arg.startsWith('--lifecycle-file='));
    if (lifecycleFile) {
      const path = lifecycleFile.slice('--lifecycle-file='.length);
      lifecycle.push({ path, policy: JSON.parse(readFileSync(path, 'utf8')) as unknown });
    }
    return responses[operation] ?? '';
  };
  return { commands, lifecycle, command };
}

describe('native storage bootstrap contract', () => {
  it('enables the storage API and publishes private storage and cache configuration', () => {
    expect(REQUIRED_GCP_APIS).toContain('storage.googleapis.com');
    expect(PRODUCTION_VAR_NAMES).toContain('GCS_BLOB_BUCKET');
    expect(REPO_VAR_NAMES).toEqual(
      expect.arrayContaining(['TURBO_API', 'TURBO_TEAM', 'GCP_TURBO_CACHE_SERVICE_ACCOUNT']),
    );
  });

  it('creates separate private buckets with bucket-scoped runtime access', () => {
    const fixture = provider();
    const result = setupDocketStorage(CONFIG, fixture.command);
    const creates = fixture.commands.filter(
      ({ args }) => args.slice(0, 3).join(' ') === 'storage buckets create',
    );

    expect(result).toEqual({
      artifactBucket: 'athena-services-docket-artifacts',
      cacheBucket: 'athena-services-docket-turbo-cache',
      cacheClientSaEmail: CLIENT,
      cacheUrl: 'https://docket-turbo-cache.example.run.app',
    });
    expect(creates).toHaveLength(2);
    for (const { args } of creates) {
      expect(args).toEqual(
        expect.arrayContaining([
          '--uniform-bucket-level-access',
          '--public-access-prevention',
          '--soft-delete-duration=0',
        ]),
      );
    }
    const access = fixture.commands.filter(({ args }) =>
      args.includes('--role=roles/storage.objectUser'),
    );
    expect(access).toHaveLength(2);
    expect(access[0]?.args).toEqual(
      expect.arrayContaining([
        'gs://athena-services-docket-artifacts',
        `--member=serviceAccount:${CONFIG.apiRuntimeSaEmail}`,
      ]),
    );
    expect(access[1]?.args).toEqual(
      expect.arrayContaining([
        'gs://athena-services-docket-turbo-cache',
        `--member=serviceAccount:${RUNTIME}`,
      ]),
    );
    expect(fixture.commands.some(({ args }) => args[0] === 'projects')).toBe(false);
  });

  it('cleans disposable cache after 14 days and leaves retained artifacts without a lifecycle', () => {
    const fixture = provider();
    setupDocketStorage(CONFIG, fixture.command);

    expect(fixture.lifecycle).toHaveLength(1);
    expect(fixture.lifecycle[0]?.policy).toEqual({
      rule: [{ action: { type: 'Delete' }, condition: { age: 14 } }],
    });
    expect(existsSync(fixture.lifecycle[0]?.path ?? '')).toBe(false);
    const lifecycleCall = fixture.commands.find(({ args }) =>
      args.some((arg) => arg.startsWith('--lifecycle-file=')),
    );
    expect(lifecycleCall?.args).toContain('gs://athena-services-docket-turbo-cache');
  });

  it('reuses existing resources and sends signing bytes only on stdin', () => {
    const fixture = provider(true);
    setupDocketStorage(CONFIG, fixture.command);

    expect(fixture.commands.some(({ args }) => args.includes('create'))).toBe(false);
    expect(
      fixture.commands.find(({ file, args }) => file === 'gh' && args[0] === 'secret')?.input,
    ).toBe('fixture-signing-key');
    expect(fixture.commands.flatMap(({ args }) => args).join(' ')).not.toContain(
      'fixture-signing-key',
    );
    expect(
      fixture.commands.some(({ args }) => args.includes('versions') && args.includes('add')),
    ).toBe(false);
  });

  it('pins upstream deployment and its signing version behind required IAM with streaming HTTP/2', () => {
    const fixture = provider();
    setupDocketStorage(CONFIG, fixture.command);
    const deployment = fixture.commands.find(
      ({ args }) => args.slice(0, 2).join(' ') === 'run deploy',
    );

    expect(deployment?.args).toEqual(
      expect.arrayContaining([
        `--image=${TURBO_CACHE_IMAGE}`,
        '--no-allow-unauthenticated',
        '--invoker-iam-check',
        '--use-http2',
        '--min=0',
        '--max=1',
        '--cpu-throttling',
        '--set-secrets=TURBO_REMOTE_CACHE_SIGNATURE_KEY=docket-turbo-cache-signing-key:7',
      ]),
    );
    expect(deployment?.args.join(' ')).toContain(
      'AUTH_MODE=none,STORAGE_PROVIDER=google-cloud-storage,STORAGE_PATH=athena-services-docket-turbo-cache,HTTP2=true,BODY_LIMIT=1073741824',
    );
    expect(deployment?.args.join(' ')).not.toMatch(/GCS_PRIVATE_KEY|GCS_CLIENT_EMAIL|TURBO_TOKEN=/);
  });

  it('restricts WIF to main and scopes local impersonation and invocation to the cache', () => {
    const fixture = provider();
    setupDocketStorage(CONFIG, fixture.command);
    const wif = fixture.commands.find(({ args }) =>
      args.includes('--role=roles/iam.workloadIdentityUser'),
    );
    const operator = fixture.commands.find(({ args }) =>
      args.includes('--role=roles/iam.serviceAccountTokenCreator'),
    );
    const invocation = fixture.commands.find(
      ({ args }) => args.slice(0, 3).join(' ') === 'run services add-iam-policy-binding',
    );

    expect(wif?.args).toContain(
      '--member=principal://iam.googleapis.com/projects/770668668034/locations/global/workloadIdentityPools/github/subject/repo:TheHypertextStudio/athena-web:ref:refs/heads/main',
    );
    expect(wif?.args).toContain(CLIENT);
    expect(operator?.args).toEqual(
      expect.arrayContaining([CLIENT, '--member=user:operator@example.com']),
    );
    expect(invocation?.args).toEqual(
      expect.arrayContaining([
        'docket-turbo-cache',
        `--member=serviceAccount:${CLIENT}`,
        '--role=roles/run.invoker',
      ]),
    );
    const removals = fixture.commands.filter(({ args }) =>
      args.includes('remove-iam-policy-binding'),
    );
    expect(removals).toHaveLength(2);
    expect(removals.flatMap(({ args }) => args)).not.toContain(
      '--member=serviceAccount:existing@example.com',
    );
  });

  it('stops when provider inspection fails instead of treating denied access as missing storage', () => {
    const fixture = provider(true);
    const denied: StorageCommand = (file, args, input) => {
      if (args.slice(0, 3).join(' ') === 'storage buckets list')
        throw new Error('PERMISSION_DENIED');
      return fixture.command(file, args, input);
    };

    expect(() => setupDocketStorage(CONFIG, denied)).toThrow('PERMISSION_DENIED');
    expect(fixture.commands.some(({ args }) => args.includes('create') || args[0] === 'run')).toBe(
      false,
    );
  });

  it('rejects an empty signing key before exporting credentials or deploying', () => {
    const fixture = provider(true);
    const emptyKey: StorageCommand = (file, args, input) =>
      args.slice(0, 3).join(' ') === 'secrets versions access'
        ? ''
        : fixture.command(file, args, input);

    expect(() => setupDocketStorage(CONFIG, emptyKey)).toThrow('cache signing key is empty');
    expect(fixture.commands.some(({ file, args }) => file === 'gh' || args[0] === 'run')).toBe(
      false,
    );
  });

  it('keeps the GitHub variable completeness guard after extracting it from bootstrap', () => {
    expect(() => {
      assertWritesEveryName({ TURBO_API: 'https://cache.example' }, ['TURBO_API'], 'CACHE_VARS');
    }).not.toThrow();
    expect(() => {
      assertWritesEveryName({}, ['TURBO_API'], 'CACHE_VARS');
    }).toThrow('CACHE_VARS promises TURBO_API');
  });
});
