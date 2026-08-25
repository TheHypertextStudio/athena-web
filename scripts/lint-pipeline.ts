import { spawn } from 'node:child_process';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx']);
const ROOT_LINT_FILES = new Set([
  'eslint.config.js',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
]);
const ROOT_CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const WORKSPACE_ROOTS = ['apps', 'domains', 'packages', 'services', 'tooling'] as const;

/** A workspace package that staged lint can address through a Turbo filter. */
export interface WorkspacePackage {
  name: string;
  directory: string;
  hasLint: boolean;
}

/** The amount of lint work required by the currently staged paths. */
export interface LintTargets {
  mode: 'none' | 'packages' | 'full';
  packages: string[];
}

/** One memory-compatible shard in the local full-lint schedule. */
export interface LintShard {
  label: string;
  filters: string[];
}

/** Options for a child process that must stop within a wall-clock limit. */
export interface RunCommandOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  label: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'pipe';
}

/** The observable result of a bounded child process. */
export interface RunCommandResult {
  durationMs: number;
  stdout: string;
  stderr: string;
}

/** Cache summary shown before pruning or diagnostic lint runs. */
export interface TurboCacheStatus {
  artifactCount: number;
  fileCount: number;
  totalBytes: number;
  oldestArtifactAt: Date | null;
  newestArtifactAt: Date | null;
}

/** Options that constrain a recoverable Turbo cache prune. */
export interface PruneTurboCacheOptions {
  cacheDirectory: string;
  now: Date;
  maxAgeMs: number;
  maxBytes: number;
  timeBudgetMs: number;
}

/** The cache space reclaimed by one pruning pass. */
export interface PruneTurboCacheResult {
  beforeBytes: number;
  afterBytes: number;
  removedArtifacts: number;
  timeBudgetExceeded: boolean;
}

interface CacheArtifact {
  hash: string;
  paths: string[];
  bytes: number;
  modifiedAt: Date;
  hasArchive: boolean;
}

/** Reports that a bounded lint subprocess exceeded its declared limit. */
export class CommandTimedOutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  /** Creates a timeout error that names the stalled lint shard. */
  constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded its ${Math.round(timeoutMs / 1_000)} second limit.`);
    this.name = 'CommandTimedOutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index).toLowerCase();
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isDocumentationPath(path: string): boolean {
  return path.startsWith('docs/') || DOCUMENT_EXTENSIONS.has(extension(path));
}

function workspaceForPath(
  path: string,
  workspaces: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  return [...workspaces]
    .sort((left, right) => right.directory.length - left.directory.length)
    .find(
      (workspace) => path === workspace.directory || path.startsWith(`${workspace.directory}/`),
    );
}

/**
 * Selects no lint, package lint, or full lint from repository-relative staged paths.
 *
 * @param stagedPaths Repository-relative paths from Git's staged diff.
 * @param workspaces Workspace package names and directories discovered from package manifests.
 * @returns The bounded lint scope required by the staged change.
 */
export function selectLintTargets(
  stagedPaths: readonly string[],
  workspaces: readonly WorkspacePackage[],
): LintTargets {
  const packages = new Set<string>();

  for (const rawPath of stagedPaths) {
    const path = normalizePath(rawPath);
    if (!path || isDocumentationPath(path)) continue;
    if (
      ROOT_LINT_FILES.has(path) ||
      /^tsconfig(?:\.[^/]+)?\.json$/.test(path) ||
      path.startsWith('scripts/')
    ) {
      return { mode: 'full', packages: [] };
    }

    const workspace = workspaceForPath(path, workspaces);
    if (workspace) {
      packages.add(workspace.name);
      continue;
    }

    if (WORKSPACE_ROOTS.some((root) => path.startsWith(`${root}/`))) {
      return { mode: 'full', packages: [] };
    }

    if (ROOT_CODE_EXTENSIONS.has(extension(path))) {
      return { mode: 'full', packages: [] };
    }
  }

  if (packages.size === 0) return { mode: 'none', packages: [] };
  return { mode: 'packages', packages: [...packages].sort() };
}

/**
 * Discovers one-level workspace packages from the repository's declared workspace roots.
 *
 * @param repositoryRoot Absolute repository worktree root.
 * @returns Every readable workspace package sorted by directory.
 */
export async function loadWorkspacePackages(repositoryRoot: string): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = [];
  for (const rootName of WORKSPACE_ROOTS) {
    const rootPath = join(repositoryRoot, rootName);
    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = `${rootName}/${entry.name}`;
      try {
        const packageJson = JSON.parse(
          await readFile(join(repositoryRoot, directory, 'package.json'), 'utf8'),
        ) as { name?: unknown; scripts?: Record<string, string> };
        if (typeof packageJson.name !== 'string') continue;
        packages.push({
          name: packageJson.name,
          directory,
          hasLint: typeof packageJson.scripts?.['lint'] === 'string',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
    }
  }
  return packages.sort((left, right) => left.directory.localeCompare(right.directory));
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * Runs a command in its own process group and terminates the group after a wall-clock timeout.
 *
 * @param options Executable, arguments, environment, output mode, and timeout.
 * @returns Captured output and duration when the command succeeds.
 * @throws {@link CommandTimedOutError} when the timeout expires.
 * @throws An Error when the command cannot start or exits unsuccessfully.
 */
export function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const startedAt = performance.now();
  const stdio = options.stdio ?? 'inherit';

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      const pid = child.pid;
      if (pid !== undefined) {
        terminateProcessGroup(pid, 'SIGTERM');
        killTimer = setTimeout(() => {
          terminateProcessGroup(pid, 'SIGKILL');
        }, 2_000);
        killTimer.unref();
      }
    }, options.timeoutMs);
    timeout.unref();

    child.once('error', (error) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      rejectPromise(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const durationMs = performance.now() - startedAt;
      if (timedOut) {
        rejectPromise(new CommandTimedOutError(options.label, options.timeoutMs));
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new Error(
            `${options.label} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}.${stderr ? `\n${stderr.trim()}` : ''}`,
          ),
        );
        return;
      }
      resolvePromise({ durationMs, stdout, stderr });
    });
  });
}

/**
 * Returns the two-phase full lint schedule that keeps memory-heavy packages apart.
 *
 * @returns Two sequential phases whose entries may run concurrently within a phase.
 */
export function createFullLintPlan(): LintShard[][] {
  return [
    [
      { label: 'API', filters: ['@docket/api'] },
      {
        label: 'remaining packages',
        filters: ['!@docket/api', '!@docket/web', '!@docket/admin'],
      },
    ],
    [{ label: 'Web and Admin', filters: ['@docket/web', '@docket/admin'] }],
  ];
}

/**
 * Builds the one-shard staged lint request that includes every selected package's dependents.
 *
 * @param packageNames Selected workspace package names.
 * @returns A labeled Turbo shard with reverse-dependency filters.
 */
export function createStagedLintShard(packageNames: readonly string[]): LintShard {
  return {
    label: packageNames.join(', '),
    filters: packageNames.map((name) => `...${name}`),
  };
}

/**
 * Runs lint phases in order while allowing the memory-compatible shards in one phase to overlap.
 *
 * @param plan Sequential phases of compatible lint shards.
 * @param run One bounded shard executor.
 * @throws The first shard failure after every shard in that phase has settled.
 */
export async function runLintPlan(
  plan: readonly (readonly LintShard[])[],
  run: (shard: LintShard) => Promise<unknown>,
): Promise<void> {
  for (const phase of plan) {
    const results = await Promise.allSettled(phase.map((shard) => run(shard)));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }
}

function hashForCacheFile(filename: string): string | null {
  if (filename.endsWith('.tar.zst')) return filename.slice(0, -'.tar.zst'.length);
  if (filename.endsWith('-meta.json')) return filename.slice(0, -'-meta.json'.length);
  if (filename.endsWith('-manifest.json')) return filename.slice(0, -'-manifest.json'.length);
  return null;
}

async function readCacheArtifacts(cacheDirectory: string): Promise<CacheArtifact[]> {
  let filenames: string[];
  try {
    filenames = await readdir(cacheDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const groups = new Map<string, CacheArtifact>();
  for (const filename of filenames) {
    const hash = hashForCacheFile(filename);
    if (hash === null) continue;
    const path = join(cacheDirectory, filename);
    const fileStat = await stat(path);
    const group = groups.get(hash) ?? {
      hash,
      paths: [],
      bytes: 0,
      modifiedAt: fileStat.mtime,
      hasArchive: false,
    };
    group.paths.push(path);
    group.bytes += fileStat.size;
    if (fileStat.mtime > group.modifiedAt) group.modifiedAt = fileStat.mtime;
    if (filename.endsWith('.tar.zst')) group.hasArchive = true;
    groups.set(hash, group);
  }
  return [...groups.values()];
}

/**
 * Measures the recoverable Turbo cache without reading artifact contents.
 *
 * @param cacheDirectory Absolute path to Turbo's cache artifact directory.
 * @returns File count, artifact count, total bytes, and age range.
 */
export async function cacheStatus(cacheDirectory: string): Promise<TurboCacheStatus> {
  const artifacts = await readCacheArtifacts(cacheDirectory);
  const archives = artifacts.filter((artifact) => artifact.hasArchive);
  const dates = archives
    .map((artifact) => artifact.modifiedAt)
    .sort((a, b) => a.getTime() - b.getTime());
  return {
    artifactCount: archives.length,
    fileCount: artifacts.reduce((count, artifact) => count + artifact.paths.length, 0),
    totalBytes: artifacts.reduce((bytes, artifact) => bytes + artifact.bytes, 0),
    oldestArtifactAt: dates[0] ?? null,
    newestArtifactAt: dates.at(-1) ?? null,
  };
}

/**
 * Removes expired cache groups first and then the oldest groups until the cache fits its limit.
 *
 * @param options Cache directory, retention limits, reference time, and wall-clock budget.
 * @returns Reclaimed bytes, removed artifact count, and whether the time budget stopped pruning.
 */
export async function pruneTurboCache(
  options: PruneTurboCacheOptions,
): Promise<PruneTurboCacheResult> {
  const startedAt = performance.now();
  const artifacts = (await readCacheArtifacts(options.cacheDirectory)).sort(
    (left, right) => left.modifiedAt.getTime() - right.modifiedAt.getTime(),
  );
  const beforeBytes = artifacts.reduce((bytes, artifact) => bytes + artifact.bytes, 0);
  let afterBytes = beforeBytes;
  let removedArtifacts = 0;
  let timeBudgetExceeded = false;
  const removed = new Set<string>();

  const removeArtifact = async (artifact: CacheArtifact): Promise<boolean> => {
    if (performance.now() - startedAt >= options.timeBudgetMs) {
      timeBudgetExceeded = true;
      return false;
    }
    await Promise.all(artifact.paths.map((path) => rm(path, { force: true })));
    removed.add(artifact.hash);
    afterBytes -= artifact.bytes;
    if (artifact.hasArchive) removedArtifacts += 1;
    return true;
  };

  const cutoff = options.now.getTime() - options.maxAgeMs;
  for (const artifact of artifacts) {
    if (artifact.modifiedAt.getTime() >= cutoff) continue;
    if (!(await removeArtifact(artifact))) break;
  }

  if (afterBytes > options.maxBytes) {
    for (const artifact of artifacts) {
      if (afterBytes <= options.maxBytes) break;
      if (removed.has(artifact.hash)) continue;
      if (!(await removeArtifact(artifact))) break;
    }
  }

  return { beforeBytes, afterBytes, removedArtifacts, timeBudgetExceeded };
}

/**
 * Resolves the shared Turbo cache from Git's common directory for the current worktree.
 *
 * @param repositoryRoot Absolute current worktree root.
 * @param gitCommonDirectory Git's absolute or worktree-relative common directory.
 * @returns The cache directory shared by all worktrees of the repository.
 */
export function resolveTurboCacheDirectory(
  repositoryRoot: string,
  gitCommonDirectory: string,
): string {
  const common = resolve(repositoryRoot, gitCommonDirectory);
  const repositoryDirectory = resolve(common, '..');
  return join(repositoryDirectory, '.turbo', 'cache');
}

/**
 * Converts an absolute worktree path into the slash-separated form used by staged selection.
 *
 * @param repositoryRoot Absolute current worktree root.
 * @param path Absolute path within that worktree.
 * @returns A normalized repository-relative path.
 */
export function repositoryRelativePath(repositoryRoot: string, path: string): string {
  return relative(repositoryRoot, path).split(sep).join('/');
}
