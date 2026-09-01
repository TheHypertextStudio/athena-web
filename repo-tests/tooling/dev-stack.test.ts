import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(import.meta.dirname, '../../scripts/dev-stack.sh'), 'utf8');
const apiTurbo = readFileSync(resolve(import.meta.dirname, '../../apps/api/turbo.json'), 'utf8');

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
});
