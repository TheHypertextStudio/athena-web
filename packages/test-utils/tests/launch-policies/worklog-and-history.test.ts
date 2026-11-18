import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../workspace';

/** Run git in the workspace and return its trimmed stdout. */
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8' }).trim();
}

/** Resolve the integration branch in local worktrees and detached CI checkouts. */
function mainlineRef(): string {
  for (const ref of ['main', 'origin/main']) {
    try {
      git('rev-parse', '--verify', '--quiet', ref);
      return ref;
    } catch {
      // A detached CI checkout normally has origin/main but no local main branch.
    }
  }
  throw new Error('Cannot verify linear history because neither main nor origin/main exists');
}

describe('launch history policy', () => {
  it('keeps the branch history linear', () => {
    const base = git('merge-base', mainlineRef(), 'HEAD');
    const merges = git('rev-list', '--merges', '--count', `${base}..HEAD`);
    expect(merges, 'MISS-07: rebase or cherry-pick onto main; never merge into it').toBe('0');
  });
});
