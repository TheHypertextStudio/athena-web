/**
 * Which checkout this is, and therefore which hosts and ports belong to it.
 *
 * @remarks
 * Every host in the dev stack is a `*.docket.localhost` name, and the whole `.localhost` TLD
 * resolves to `127.0.0.1`. A branch prefix therefore decorates the *name* and does nothing to the
 * *address*: two checkouts that pick the same port both answer on `127.0.0.1:<port>`, and whichever
 * bound it first serves both. The port block has to come from the checkout for the address to
 * distinguish them at all.
 */
import { execFileSync } from 'node:child_process';

/** Where a checkout lives and how git sees it. */
export interface CheckoutIdentity {
  /** Absolute path to the working tree root. */
  readonly root: string;
  /** Absolute path to this checkout's own git directory. */
  readonly gitDir: string;
  /** Absolute path to the git directory shared by every worktree. */
  readonly gitCommonDir: string;
  /** The checked-out branch's short name. */
  readonly branch: string;
}

/** The primary checkout's web port. Documented URLs and anything holding the number keep it. */
export const PRIMARY_WEB_PORT = 1355;

/** First port of the range worktrees derive their blocks from. */
export const WORKTREE_PORT_FLOOR = 1400;

/** Ports per checkout: web, api, admin, runner. */
export const PORT_STRIDE = 4;

/** How many stride-sized blocks the worktree range holds. */
export const WORKTREE_SLOTS = 150;

/**
 * First port of the range the runner uses under Portless.
 *
 * @remarks
 * Portless assigns the web, api and admin apps their own free ports, so only the runner needs one
 * derived — `wrangler dev --local` has no portless entry and would otherwise bind its fixed 8787 in
 * every checkout.
 *
 * It is a separate range from the explicit-port block because `dev-stack.sh` counts a port held by
 * *this* checkout as free, so that restarting reclaims its own ports instead of drifting upward. A
 * portless runner sitting on the block's runner slot would satisfy that check and then fail to
 * bind, which is a confusing way to learn about a leftover process.
 *
 * The two modes still cannot run at the same time for one checkout: both drive `next dev` in
 * `apps/web`, and `.next/dev/lock` admits one server per directory. Stop one before starting the
 * other.
 */
export const PORTLESS_RUNNER_FLOOR = 2000;

/**
 * Whether this is a linked worktree rather than the primary checkout.
 *
 * @remarks
 * A worktree checked out on `main` or `master` is treated as primary, because that is the checkout
 * whose URLs the documentation names.
 */
export function isLinkedWorktree(identity: CheckoutIdentity): boolean {
  if (identity.gitDir === identity.gitCommonDir) return false;
  return identity.branch !== 'main' && identity.branch !== 'master';
}

/**
 * The hostname prefix this checkout's services answer on.
 *
 * @returns A prefix ending in `.`, or the empty string for the primary checkout.
 */
export function hostPrefix(identity: CheckoutIdentity): string {
  return isLinkedWorktree(identity) ? `${identity.branch.split('/').pop() ?? ''}.` : '';
}

/**
 * FNV-1a over a string, as an unsigned 32-bit number.
 *
 * @remarks
 * Any stable hash would do. FNV-1a is here because it is short enough to read and verify in place,
 * which matters for a value that decides whether two checkouts collide.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The first port of this checkout's block.
 *
 * @remarks
 * Derived from the git directory rather than the branch name, because the git directory survives a
 * branch rename and the branch name does not — a rename would otherwise move a running stack's
 * ports out from under it.
 *
 * Two worktrees can still hash to the same slot. Resolving that needs to know what is actually
 * listening, so it belongs to the caller starting the stack, not to this pure derivation.
 */
export function deriveWebPort(identity: CheckoutIdentity): number {
  if (!isLinkedWorktree(identity)) return PRIMARY_WEB_PORT;
  return WORKTREE_PORT_FLOOR + checkoutSlot(identity) * PORT_STRIDE;
}

/** This checkout's slot in the worktree range; `0` for the primary checkout. */
export function checkoutSlot(identity: CheckoutIdentity): number {
  if (!isLinkedWorktree(identity)) return 0;
  return fnv1a(identity.gitDir) % WORKTREE_SLOTS;
}

/**
 * The port the runner binds under Portless.
 *
 * @remarks
 * Distinct from the explicit-port block's runner slot so both modes can be up at once. See
 * {@link PORTLESS_RUNNER_FLOOR}.
 */
export function derivePortlessRunnerPort(identity: CheckoutIdentity): number {
  return PORTLESS_RUNNER_FLOOR + checkoutSlot(identity);
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

/**
 * Read this checkout's identity from git.
 *
 * @param root - The working tree root to inspect.
 * @throws When `root` is not inside a git working tree.
 */
export function readCheckoutIdentity(root: string): CheckoutIdentity {
  return {
    root,
    gitDir: git(root, ['rev-parse', '--absolute-git-dir']),
    gitCommonDir: git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
  };
}
