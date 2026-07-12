import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const validator = resolve(import.meta.dirname, '../../scripts/validate-commit-message.mjs');

function validate(message: string): { readonly status: number | null; readonly stderr: string } {
  const directory = mkdtempSync(join(tmpdir(), 'docket-commit-message-'));
  const messagePath = join(directory, 'COMMIT_EDITMSG');
  writeFileSync(messagePath, message);
  const result = spawnSync(process.execPath, [validator, messagePath], { encoding: 'utf8' });
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

  it('formats the subject and wraps substantive body prose', () => {
    const directory = mkdtempSync(join(tmpdir(), 'docket-commit-format-'));
    const messagePath = join(directory, 'COMMIT_EDITMSG');
    writeFileSync(messagePath, `fix(dx): enforce repository commit policy\n\n${validBody}`);
    execFileSync(process.execPath, [validator, messagePath]);
    const formatted = readFileSync(messagePath, 'utf8');
    expect(formatted).toMatch(/^fix\(dx\): Enforce repository commit policy/);
    expect(formatted.split('\n').every((line) => line.length <= 72)).toBe(true);
  });
});
