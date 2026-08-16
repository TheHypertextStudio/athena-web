import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const hook = resolve(import.meta.dirname, '../../.codex/hooks/validate-commit-scope.mjs');

function check(command: string): { readonly status: number | null; readonly stdout: string } {
  const result = spawnSync(process.execPath, [hook], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { cmd: command },
    }),
  });
  return { status: result.status, stdout: result.stdout };
}

describe('Codex commit scope hook', () => {
  it('allows an approved scoped commit', () => {
    expect(check('git commit -m "fix(api): Keep tenant reads isolated"').status).toBe(0);
  });

  it('allows shell commands that do not create commits', () => {
    expect(check('git status --short').status).toBe(0);
  });

  it('rejects an unapproved scope', () => {
    const result = check('git commit -m "fix(calendar): Keep dates stable"');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });

  it('reads the subject from a stdin commit message', () => {
    const result = check(`git commit -F - <<'EOF'
feat(unknown): Add a thing

Explain the change in a substantive body supplied to the ordinary commit hook.
EOF`);
    expect(result.status).toBe(2);
  });
});
