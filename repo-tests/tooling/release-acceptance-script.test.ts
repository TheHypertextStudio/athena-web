import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../scripts/ci-gate-policy';

const runnerPath = join(REPO_ROOT, 'scripts/run-release-acceptance.sh');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    spawnSync('rm', ['-rf', directory]);
  }
});

function readRunner(): string {
  const exists = existsSync(runnerPath);
  expect(exists).toBe(true);
  return exists ? readFileSync(runnerPath, 'utf8') : '';
}

describe('release acceptance runner', () => {
  it('is the executable root release command', () => {
    const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const webPackage = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/web/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(rootPackage.scripts['test:release']).toBe('scripts/run-release-acceptance.sh');
    expect(webPackage.scripts['test:e2e:release']).toBe('playwright test e2e/release --workers=1');

    if (!existsSync(runnerPath)) {
      expect(existsSync(runnerPath)).toBe(true);
      return;
    }
    expect(statSync(runnerPath).mode & 0o111).not.toBe(0);
  });

  it('owns an isolated production stack and cleans every resource it starts', () => {
    const source = readRunner();

    expect(source).toContain('set -euo pipefail');
    expect(source).toMatch(/RUN_ID=.*\$\$.*\$\{RANDOM\}/);
    expect(source).toContain('docket-release-${RUN_ID}');
    expect(source).toContain('docket_release_${RUN_ID//-/_}');
    expect(source).toContain('postgres:17-alpine');
    expect(source).not.toMatch(/docker run[^\n]+--rm/);
    expect(source).toContain('127.0.0.1::5432');
    expect(source).toContain('docker port');
    expect(source).toContain('unused_loopback_port');
    expect(source).toContain('NODE_ENV=production');
    expect(source).toContain('NODE_OPTIONS=--max-old-space-size=4096');
    expect(source).toMatch(/turbo run build[^\n]+--filter=@docket\/api[^\n]+--filter=@docket\/web/);
    expect(source).toContain('apps/web/.next/standalone/apps/web');
    expect(source).toContain('apps/web/.next/static');
    expect(source).toContain('${standalone_root}/.next/static');
    expect(source).toContain('${standalone_root}/public');
    expect(source).toContain('/v1/health');
    expect(source).toContain('/sign-in');
    expect(source).toContain('pnpm --filter @docket/web test:e2e:release');
    expect(source).toContain('RELEASE_EVIDENCE:-0');
    expect(source).toContain('e2e/work/initiative-roster-shots.spec.ts --workers=1');
    expect(source).toContain('trap cleanup EXIT');
    expect(source).toContain("trap 'exit 130' INT");
    expect(source).toContain("trap 'exit 143' TERM");
    expect(source).toContain('API_PID');
    expect(source).toContain('WEB_PID');
    expect(source).toContain('docker rm -f');
    expect(source).toContain('rm -rf -- "${TEMP_DIR}"');
  });

  it('forces the generated database URL through a hostile dotenv file', () => {
    const source = readRunner();
    if (source.length === 0) return;

    const fixture = mkdtempSync(join(tmpdir(), 'docket-release-runner-test-'));
    temporaryDirectories.push(fixture);
    const binDirectory = join(fixture, 'bin');
    spawnSync('mkdir', ['-p', binDirectory]);
    const capturePath = join(fixture, 'migration-env.txt');
    const envPath = join(fixture, '.env.local');
    const fakePnpmPath = join(binDirectory, 'pnpm');
    const generatedUrl = 'postgres://docket:docket@127.0.0.1:49152/docket_release_123_456';

    writeFileSync(
      envPath,
      [
        'DATABASE_URL=postgres://hostile:hostile@127.0.0.1:1/wrong',
        'DATABASE_URL_UNPOOLED=postgres://hostile:hostile@127.0.0.1:2/wrong',
        '',
      ].join('\n'),
    );
    writeFileSync(
      fakePnpmPath,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "exec" && "\${2:-}" == "dotenv" ]]; then
  shift 2
  [[ "\${1:-}" == "-e" ]]
  env_file="$2"
  shift 2
  [[ "\${1:-}" == "--" ]]
  shift
  set -a
  source "$env_file"
  set +a
  exec "$@"
fi
printf '%s\\n%s\\n' "\${DATABASE_URL:-}" "\${DATABASE_URL_UNPOOLED:-}" > "$CAPTURE_FILE"
`,
    );
    chmodSync(fakePnpmPath, 0o755);

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; run_migrations "$2" "$3"',
        'release-acceptance-test',
        runnerPath,
        generatedUrl,
        envPath,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          CAPTURE_FILE: capturePath,
          PATH: `${binDirectory}:${process.env['PATH'] ?? ''}`,
        },
      },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(capturePath, 'utf8').trim().split('\n')).toEqual([
      generatedUrl,
      generatedUrl,
    ]);
  });
});
