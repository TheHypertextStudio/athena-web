import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(import.meta.dirname, '../../scripts/dev-stack.sh'), 'utf8');
const apiTurbo = readFileSync(resolve(import.meta.dirname, '../../apps/api/turbo.json'), 'utf8');
const adminManifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../apps/admin/package.json'), 'utf8'),
) as {
  readonly devDependencies?: Readonly<Record<string, string>>;
};

describe('documented development stack', () => {
  it('reserves enough Turbo slots for every persistent development task', () => {
    expect(script).toContain('ulimit -n 8192');
    expect(script).toContain('TURBO_CONCURRENCY=5 nohup pnpm dev');
  });

  it('scopes process cleanup to the current worktree', () => {
    const processKills = script.split('\n').filter((line) => line.trim().startsWith('pkill -f'));

    expect(processKills).not.toHaveLength(0);
    expect(processKills.every((line) => line.includes('$ROOT'))).toBe(true);
    expect(script).toContain('$ROOT/apps/(web|admin)/.*next.*dev');
    expect(script).not.toContain('portless proxy stop');
  });

  it('passes operator configuration through Turbo strict environment mode', () => {
    expect(apiTurbo).toContain('"ADMIN_*"');
  });

  it('isolates Portless discovery from other repositories using the same proxy ports', () => {
    expect(script).toContain('export PORTLESS_STATE_DIR=');
    expect(script).toContain('docket-portless-${UID}-${PREFIX}');
  });

  it('keeps the CI port by default while allowing a collision-free local override', () => {
    expect(script).toContain('PORT="${DOCKET_DEV_PORT:-1355}"');
  });

  it('uses Portless bare routes in the primary checkout and prefixes linked worktrees', () => {
    expect(script).toContain('HOST_PREFIX=""');
    expect(script).toContain('if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]');
    expect(script).toContain('HOST_PREFIX="$PREFIX."');
    expect(script).toContain('http://${HOST_PREFIX}docket.localhost:$PORT');
  });

  it('declares the CLI used to bootstrap the admin app', () => {
    expect(adminManifest.devDependencies?.['tsx']).toBeDefined();
  });
});
