import { describe, expect, it } from 'vitest';

import { PRODUCTION_VAR_NAMES, REPO_VAR_NAMES, REQUIRED_GCP_APIS } from '../../scripts/bootstrap';
import {
  setupDocketStorage,
  TURBO_CACHE_BUCKET,
  TURBO_CACHE_URL,
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

interface Invocation {
  file: string;
  args: readonly string[];
  input: string | undefined;
}

/** Record native operations and return fixture state at the subprocess boundary. */
function provider(existing = false): { commands: Invocation[]; command: StorageCommand } {
  const commands: Invocation[] = [];
  const responses: Record<string, string> = {
    'iam service-accounts list': existing ? CLIENT : '',
    'storage buckets list': existing ? 'gs://athena-services-docket-artifacts/' : '',
    'secrets list --project=athena-services': existing
      ? 'projects/athena-services/secrets/docket-turbo-cache-signing-key'
      : '',
    'secrets versions access': 'fixture-signing-key',
    'secret list --repo': '[]',
    'auth list --filter=status:ACTIVE': 'operator@example.com',
  };
  const command: StorageCommand = (file, args, input) => {
    commands.push({ file, args, input });
    return responses[args.slice(0, 3).join(' ')] ?? '';
  };
  return { commands, command };
}

describe('native storage bootstrap contract', () => {
  it('publishes the private artifact and R2 cache configuration', () => {
    expect(REQUIRED_GCP_APIS).toContain('storage.googleapis.com');
    expect(PRODUCTION_VAR_NAMES).toContain('GCS_BLOB_BUCKET');
    expect(REPO_VAR_NAMES).toEqual(
      expect.arrayContaining(['TURBO_API', 'TURBO_TEAM', 'GCP_TURBO_CACHE_SERVICE_ACCOUNT']),
    );
    const fixture = provider();
    expect(setupDocketStorage(CONFIG, fixture.command)).toEqual({
      artifactBucket: 'athena-services-docket-artifacts',
      cacheBucket: TURBO_CACHE_BUCKET,
      cacheClientSaEmail: CLIENT,
      cacheUrl: TURBO_CACHE_URL,
    });
    expect(TURBO_CACHE_BUCKET).toBe('studio-turbo-cache');
    expect(TURBO_CACHE_URL).toBe('https://turbo-cache.hypertext.studio');
  });

  it('creates only the private artifact bucket with bucket-scoped API access and no TTL', () => {
    const fixture = provider();
    setupDocketStorage(CONFIG, fixture.command);
    const creates = fixture.commands.filter(
      ({ args }) => args.slice(0, 3).join(' ') === 'storage buckets create',
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]?.args).toEqual(
      expect.arrayContaining([
        'gs://athena-services-docket-artifacts',
        '--uniform-bucket-level-access',
        '--public-access-prevention',
        '--soft-delete-duration=0',
      ]),
    );
    const access = fixture.commands.filter(({ args }) =>
      args.includes('--role=roles/storage.objectUser'),
    );
    expect(access).toHaveLength(1);
    expect(access[0]?.args).toEqual(
      expect.arrayContaining([
        'gs://athena-services-docket-artifacts',
        `--member=serviceAccount:${CONFIG.apiRuntimeSaEmail}`,
      ]),
    );
    expect(fixture.commands.flatMap(({ args }) => args).join(' ')).not.toMatch(
      /lifecycle|docket-turbo-cache@|athena-services-docket-turbo-cache|storage\.objectAdmin/,
    );
    expect(fixture.commands.some(({ args }) => args[0] === 'projects' || args[0] === 'run')).toBe(
      false,
    );
  });

  it('reuses the existing client identity and artifact bucket', () => {
    const fixture = provider(true);
    setupDocketStorage(CONFIG, fixture.command);
    expect(fixture.commands.some(({ args }) => args.includes('create'))).toBe(false);
    expect(
      fixture.commands.find(({ args }) => args.slice(0, 3).join(' ') === 'storage buckets update')
        ?.args,
    ).toContain('gs://athena-services-docket-artifacts');
    expect(
      fixture.commands.some(({ args }) => args.includes('versions') && args.includes('add')),
    ).toBe(false);
  });

  it('preserves the operator signing key and never grants server access to it', () => {
    const fixture = provider(true);
    setupDocketStorage(CONFIG, fixture.command);
    const signing = fixture.commands.find(
      ({ file, args }) => file === 'gh' && args[0] === 'secret',
    );
    expect(signing?.args).toEqual([
      'secret',
      'set',
      'TURBO_REMOTE_CACHE_SIGNATURE_KEY',
      '--repo',
      CONFIG.repo,
    ]);
    expect(signing?.input).toBe('fixture-signing-key');
    expect(fixture.commands.flatMap(({ args }) => args).join(' ')).not.toContain(
      'fixture-signing-key',
    );
    expect(
      fixture.commands.some(({ args }) =>
        args.includes('--role=roles/secretmanager.secretAccessor'),
      ),
    ).toBe(false);
  });

  it('generates a first-time client signing key only through stdin', () => {
    const fixture = provider();
    setupDocketStorage(CONFIG, fixture.command);
    const creation = fixture.commands.find(
      ({ args }) => args.slice(0, 2).join(' ') === 'secrets create',
    );
    expect(creation?.args).toEqual(
      expect.arrayContaining(['docket-turbo-cache-signing-key', '--data-file=-']),
    );
    expect(creation?.input).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.commands.flatMap(({ args }) => args)).not.toContain(creation?.input);
  });

  it('preserves an unknown existing GitHub key if its operator copy is absent', () => {
    const fixture = provider();
    const existingGithub: StorageCommand = (file, args, input) =>
      file === 'gh' && args[0] === 'secret' && args[1] === 'list'
        ? '[{"name":"TURBO_REMOTE_CACHE_SIGNATURE_KEY"}]'
        : fixture.command(file, args, input);
    setupDocketStorage(CONFIG, existingGithub);
    expect(fixture.commands.some(({ args }) => args[0] === 'secrets' && args[1] !== 'list')).toBe(
      false,
    );
    expect(fixture.commands.some(({ file }) => file === 'gh')).toBe(false);
  });

  it('restricts WIF to main and scopes local impersonation to the cache client', () => {
    const fixture = provider();
    setupDocketStorage(CONFIG, fixture.command);
    const wif = fixture.commands.find(({ args }) =>
      args.includes('--role=roles/iam.workloadIdentityUser'),
    );
    const operator = fixture.commands.find(({ args }) =>
      args.includes('--role=roles/iam.serviceAccountTokenCreator'),
    );
    expect(wif?.args).toContain(
      '--member=principal://iam.googleapis.com/projects/770668668034/locations/global/workloadIdentityPools/github/subject/repo:TheHypertextStudio/athena-web:ref:refs/heads/main',
    );
    expect(wif?.args).toContain(CLIENT);
    expect(operator?.args).toEqual(
      expect.arrayContaining([CLIENT, '--member=user:operator@example.com']),
    );
    expect(fixture.commands.some(({ args }) => args.includes('--role=roles/run.invoker'))).toBe(
      false,
    );
  });

  it('stops when provider inspection fails instead of creating replacement resources', () => {
    const fixture = provider(true);
    const denied: StorageCommand = (file, args, input) => {
      if (args.slice(0, 3).join(' ') === 'storage buckets list')
        throw new Error('PERMISSION_DENIED');
      return fixture.command(file, args, input);
    };
    expect(() => setupDocketStorage(CONFIG, denied)).toThrow('PERMISSION_DENIED');
    expect(fixture.commands).toEqual([]);
  });

  it('rejects empty operator signing bytes before changing GitHub configuration', () => {
    const fixture = provider(true);
    const emptyKey: StorageCommand = (file, args, input) =>
      args.slice(0, 3).join(' ') === 'secrets versions access'
        ? ''
        : fixture.command(file, args, input);
    expect(() => setupDocketStorage(CONFIG, emptyKey)).toThrow('cache signing key is empty');
    expect(fixture.commands.some(({ file }) => file === 'gh')).toBe(false);
  });

  it('keeps the GitHub variable completeness guard', () => {
    expect(() => {
      assertWritesEveryName({ TURBO_API: 'https://cache.example' }, ['TURBO_API'], 'CACHE_VARS');
    }).not.toThrow();
    expect(() => {
      assertWritesEveryName({}, ['TURBO_API'], 'CACHE_VARS');
    }).toThrow('CACHE_VARS promises TURBO_API');
  });
});
