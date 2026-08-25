import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const validator = resolve(import.meta.dirname, '../../scripts/validate-commit-message.mjs');

const agentEnvironmentVariables = [
  'DOCKET_COMMIT_AGENT',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CURSOR_AGENT',
  'GITHUB_COPILOT_AGENT',
] as const;

function humanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of agentEnvironmentVariables) delete env[name];
  return env;
}

function validate(
  message: string,
  agentEnvironment: Readonly<Record<string, string>> = {},
): { readonly status: number | null; readonly stderr: string } {
  const directory = mkdtempSync(join(tmpdir(), 'docket-commit-message-'));
  const messagePath = join(directory, 'COMMIT_EDITMSG');
  writeFileSync(messagePath, message);
  const env = humanEnvironment();
  Object.assign(env, agentEnvironment);
  const result = spawnSync(process.execPath, [validator, messagePath], { encoding: 'utf8', env });
  return { status: result.status, stderr: result.stderr };
}

const validBody = `Normalize operator-provided credentials before writing them to Secret Manager. Invisible clipboard newlines change OAuth identifiers and break Google account linking.
`;

describe('commit message policy', () => {
  it.each(['feat', 'fix', 'chore'])('accepts the %s type with a substantive body', (type) => {
    expect(validate(`${type}(dx): Enforce repository commit policy\n\n${validBody}`).status).toBe(
      0,
    );
  });

  it.each(['build', 'ci', 'docs', 'perf', 'refactor', 'revert', 'style', 'test'])(
    'rejects the unsupported %s type',
    (type) => {
      const result = validate(`${type}(dx): Use an unsupported type\n\n${validBody}`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`type "${type}" is not allowed`);
    },
  );

  it('rejects a subject-only message even for a one-file change', () => {
    const result = validate('fix(auth): Reject a malformed OAuth client id\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('subject and body must be separated by a blank line');
  });

  it('rejects a placeholder body', () => {
    const result = validate(`fix(auth): Reject a malformed OAuth client id

Fix the broken OAuth client id.
`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('body with at least 100');
  });

  it('accepts Markdown sections when a longer body benefits from them', () => {
    const result = validate(`fix(auth): Reject a malformed OAuth client id

## Root cause

The copied Google client identifier contained an invisible trailing newline.

## Resolution

Normalize secret input before persistence so OAuth requests use the exact provider identifier.
`);
    expect(result.status).toBe(0);
  });

  it.each([
    ['Codex', { CODEX_THREAD_ID: 'thread-1' }],
    ['Claude Code', { CLAUDECODE: '1' }],
    ['an explicitly marked agent', { DOCKET_COMMIT_AGENT: '1' }],
  ])('rejects %s commits that omit agent attribution', (_agent, env) => {
    const result = validate(
      `fix(dx): Enforce repository commit policy

${validBody}`,
      env,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('agent commits require a Co-authored-by trailer');
  });

  it('accepts an agent commit with a valid co-author trailer', () => {
    const result = validate(
      `fix(dx): Enforce repository commit policy

${validBody}
Co-authored-by: Codex <codex@openai.com>
`,
      { CODEX_THREAD_ID: 'thread-1' },
    );

    expect(result.status).toBe(0);
  });

  it('formats the subject and wraps substantive body prose', () => {
    const directory = mkdtempSync(join(tmpdir(), 'docket-commit-format-'));
    const messagePath = join(directory, 'COMMIT_EDITMSG');
    writeFileSync(messagePath, `fix(dx): enforce repository commit policy\n\n${validBody}`);
    execFileSync(process.execPath, [validator, messagePath], { env: humanEnvironment() });
    const formatted = readFileSync(messagePath, 'utf8');
    expect(formatted).toMatch(/^fix\(dx\): Enforce repository commit policy/);
    expect(formatted.split('\n').every((line) => line.length <= 72)).toBe(true);
  });
});
