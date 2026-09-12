import { describe, expect, it } from 'vitest';

import type { CheckoutIdentity } from '../src/checkout';
import {
  derivePortlessRunnerPort,
  deriveWebPort,
  hostPrefix,
  isLinkedWorktree,
  PORT_STRIDE,
  PORTLESS_RUNNER_FLOOR,
  PRIMARY_WEB_PORT,
  WORKTREE_PORT_FLOOR,
  WORKTREE_SLOTS,
} from '../src/checkout';
import { portBlock } from '../src/topology';

function identity(overrides: Partial<CheckoutIdentity> = {}): CheckoutIdentity {
  return {
    root: '/repo',
    gitDir: '/repo/.git',
    gitCommonDir: '/repo/.git',
    branch: 'main',
    ...overrides,
  };
}

function worktree(name: string): CheckoutIdentity {
  return identity({
    root: `/repo/.worktrees/${name}`,
    gitDir: `/repo/.git/worktrees/${name}`,
    branch: `claude/${name}`,
  });
}

describe('checkout identity', () => {
  it('treats the primary checkout as unprefixed and canonical', () => {
    expect(isLinkedWorktree(identity())).toBe(false);
    expect(hostPrefix(identity())).toBe('');
    expect(deriveWebPort(identity())).toBe(PRIMARY_WEB_PORT);
  });

  it('keeps a worktree checked out on the default branch on the canonical ports', () => {
    // The documented URLs name this checkout, so a worktree tracking main must not move off them.
    const onMain = identity({ gitDir: '/repo/.git/worktrees/release', branch: 'main' });
    expect(isLinkedWorktree(onMain)).toBe(false);
    expect(deriveWebPort(onMain)).toBe(PRIMARY_WEB_PORT);
  });

  it('gives a linked worktree its own prefix and port block', () => {
    const wt = worktree('menu-audit-8c5bd7');
    expect(hostPrefix(wt)).toBe('menu-audit-8c5bd7.');
    const port = deriveWebPort(wt);
    expect(port).toBeGreaterThanOrEqual(WORKTREE_PORT_FLOOR);
    expect(port).toBeLessThan(WORKTREE_PORT_FLOOR + WORKTREE_SLOTS * PORT_STRIDE);
    expect((port - WORKTREE_PORT_FLOOR) % PORT_STRIDE).toBe(0);
    expect(port).not.toBe(PRIMARY_WEB_PORT);
  });

  it('derives the port from the git directory so a branch rename keeps the block', () => {
    const before = worktree('feature-x');
    const renamed: CheckoutIdentity = { ...before, branch: 'claude/feature-x-take-two' };
    expect(deriveWebPort(renamed)).toBe(deriveWebPort(before));
    // The hostname follows the branch even though the port does not.
    expect(hostPrefix(renamed)).toBe('feature-x-take-two.');
  });

  it('separates many worktrees without overlapping their blocks', () => {
    const names = Array.from({ length: 40 }, (_, index) => `wt-${index}`);
    const bases = names.map((name) => deriveWebPort(worktree(name)));
    // Blocks are stride-sized, so distinct bases are enough to prove no port is shared.
    const distinct = new Set(bases);
    expect(distinct.size).toBeGreaterThanOrEqual(names.length - 4);
    for (const base of distinct) {
      const block = portBlock(base);
      expect([block.web, block.api, block.admin, block.runner]).toEqual([
        base,
        base + 1,
        base + 2,
        base + 3,
      ]);
    }
  });

  it('keeps the portless runner off the explicit-port block', () => {
    // dev-stack.sh counts a port held by this checkout as free, so restarting reclaims its own
    // ports. A portless runner on the block's runner slot would satisfy that check and then fail
    // to bind.
    for (const checkout of [identity(), worktree('feature-x'), worktree('feature-y')]) {
      const block = portBlock(deriveWebPort(checkout));
      const portlessRunner = derivePortlessRunnerPort(checkout);
      expect(portlessRunner).toBeGreaterThanOrEqual(PORTLESS_RUNNER_FLOOR);
      expect([block.web, block.api, block.admin, block.runner]).not.toContain(portlessRunner);
    }
  });

  it('gives each checkout a distinct portless runner port', () => {
    const ports = new Set(
      Array.from({ length: 30 }, (_, index) => derivePortlessRunnerPort(worktree(`wt-${index}`))),
    );
    expect(ports.size).toBeGreaterThanOrEqual(27);
    // `wrangler dev --local` binds 8787 in every checkout, which is what this replaces.
    expect(ports).not.toContain(8787);
  });

  it('uses only the last path segment of a nested branch name as the host prefix', () => {
    expect(hostPrefix(identity({ gitDir: '/repo/.git/worktrees/a', branch: 'claude/a/b' }))).toBe(
      'b.',
    );
  });
});
