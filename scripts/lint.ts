#!/usr/bin/env tsx

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cacheStatus,
  createFullLintPlan,
  createStagedLintShard,
  loadWorkspacePackages,
  pruneTurboCache,
  resolveTurboCacheDirectory,
  runCommand,
  runLintPlan,
  selectLintTargets,
  type LintShard,
  type RunCommandResult,
} from './lint-pipeline.js';

const PACKAGE_TIMEOUT_MS = 3 * 60 * 1_000;
const FULL_TIMEOUT_MS = 5 * 60 * 1_000;
const CACHE_MAINTENANCE_MS = 30 * 1_000;
const CACHE_MAX_BYTES = 20 * 1_024 * 1_024 * 1_024;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1_024;
    unit += 1;
  } while (value >= 1_024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function cappedNodeEnvironment(): NodeJS.ProcessEnv {
  const existing = process.env['NODE_OPTIONS']?.trim();
  return {
    ...process.env,
    NODE_OPTIONS: [existing, '--max-old-space-size=3072'].filter(Boolean).join(' '),
  };
}

async function repositoryRoot(): Promise<string> {
  const result = await runCommand({
    command: 'git',
    args: ['rev-parse', '--show-toplevel'],
    timeoutMs: 10_000,
    label: 'Git repository lookup',
    stdio: 'pipe',
  });
  return result.stdout.trim();
}

async function sharedCacheDirectory(root: string): Promise<string> {
  const result = await runCommand({
    command: 'git',
    args: ['rev-parse', '--git-common-dir'],
    timeoutMs: 10_000,
    label: 'Git common-directory lookup',
    cwd: root,
    stdio: 'pipe',
  });
  return resolveTurboCacheDirectory(root, result.stdout.trim());
}

async function stagedFiles(root: string): Promise<string[]> {
  const result = await runCommand({
    command: 'git',
    args: ['diff', '--cached', '--name-only', '--diff-filter=ACMRD', '-z'],
    timeoutMs: 10_000,
    label: 'Staged-file lookup',
    cwd: root,
    stdio: 'pipe',
  });
  return result.stdout.split('\0').filter(Boolean);
}

function turboArguments(filters: readonly string[]): string[] {
  return [
    'exec',
    'turbo',
    'run',
    'lint',
    ...filters.map((filter) => `--filter=${filter}`),
    '--concurrency=1',
  ];
}

async function runShard(
  root: string,
  shard: LintShard,
  timeoutMs: number,
  diagnose: boolean,
): Promise<RunCommandResult> {
  console.log(`\nLinting ${shard.label}...`);
  const pnpmArguments = turboArguments(shard.filters);
  const command = diagnose ? '/usr/bin/time' : 'pnpm';
  const args = diagnose
    ? [process.platform === 'darwin' ? '-lp' : '-v', 'pnpm', ...pnpmArguments]
    : pnpmArguments;
  const result = await runCommand({
    command,
    args,
    timeoutMs,
    label: `${shard.label} lint`,
    cwd: root,
    env: cappedNodeEnvironment(),
    stdio: 'inherit',
  });
  console.log(`${shard.label} lint finished in ${(result.durationMs / 1_000).toFixed(1)} seconds.`);
  return result;
}

async function maintainCache(root: string): Promise<void> {
  const cacheDirectory = await sharedCacheDirectory(root);
  const result = await pruneTurboCache({
    cacheDirectory,
    now: new Date(),
    maxAgeMs: CACHE_MAX_AGE_MS,
    maxBytes: CACHE_MAX_BYTES,
    timeBudgetMs: CACHE_MAINTENANCE_MS,
  });
  if (result.beforeBytes === result.afterBytes) return;
  console.log(
    `Turbo cache maintenance reclaimed ${formatBytes(result.beforeBytes - result.afterBytes)}. ` +
      `${formatBytes(result.afterBytes)} remains.`,
  );
  if (result.timeBudgetExceeded) {
    console.log('Cache maintenance reached its 30 second limit and will continue on the next run.');
  }
}

async function runFullLint(root: string, diagnose: boolean): Promise<void> {
  const startedAt = performance.now();
  await maintainCache(root);
  await runLintPlan(createFullLintPlan(), async (shard) => {
    const elapsedMs = performance.now() - startedAt;
    const remainingMs = FULL_TIMEOUT_MS - elapsedMs;
    if (remainingMs <= 0) throw new Error('Full lint exceeded its 300 second limit.');
    const shardTimeout = Math.min(PACKAGE_TIMEOUT_MS, remainingMs);
    await runShard(root, shard, shardTimeout, diagnose);
  });
  const durationMs = performance.now() - startedAt;
  if (durationMs > FULL_TIMEOUT_MS) throw new Error('Full lint exceeded its 300 second limit.');
  console.log(`\nFull lint finished in ${(durationMs / 1_000).toFixed(1)} seconds.`);
}

async function runStagedLint(root: string): Promise<void> {
  const [paths, workspaces] = await Promise.all([stagedFiles(root), loadWorkspacePackages(root)]);
  const targets = selectLintTargets(paths, workspaces);
  if (targets.mode === 'none') {
    console.log('No staged source changes require ESLint.');
    return;
  }
  if (targets.mode === 'full') {
    await runFullLint(root, false);
    return;
  }
  await runShard(root, createStagedLintShard(targets.packages), PACKAGE_TIMEOUT_MS, false);
}

async function printCacheStatus(root: string): Promise<void> {
  const cacheDirectory = await sharedCacheDirectory(root);
  const status = await cacheStatus(cacheDirectory);
  console.log(`Turbo cache: ${cacheDirectory}`);
  console.log(`Artifacts: ${status.artifactCount.toLocaleString()}`);
  console.log(`Files: ${status.fileCount.toLocaleString()}`);
  console.log(`Size: ${formatBytes(status.totalBytes)}`);
  console.log(`Oldest artifact: ${status.oldestArtifactAt?.toISOString() ?? 'none'}`);
  console.log(`Newest artifact: ${status.newestArtifactAt?.toISOString() ?? 'none'}`);
}

async function pruneCache(root: string): Promise<void> {
  const cacheDirectory = await sharedCacheDirectory(root);
  const result = await pruneTurboCache({
    cacheDirectory,
    now: new Date(),
    maxAgeMs: CACHE_MAX_AGE_MS,
    maxBytes: CACHE_MAX_BYTES,
    timeBudgetMs: 5 * 60 * 1_000,
  });
  console.log(`Removed ${result.removedArtifacts.toLocaleString()} cached artifacts.`);
  console.log(`Reclaimed ${formatBytes(result.beforeBytes - result.afterBytes)}.`);
  console.log(`${formatBytes(result.afterBytes)} remains.`);
  if (result.timeBudgetExceeded) {
    throw new Error('Cache pruning reached its 300 second limit before satisfying retention.');
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const root = await repositoryRoot();
  switch (mode) {
    case 'full':
      await runFullLint(root, false);
      return;
    case 'staged':
      await runStagedLint(root);
      return;
    case 'diagnose':
      await printCacheStatus(root);
      await runFullLint(root, true);
      return;
    case 'cache-status':
      await printCacheStatus(root);
      return;
    case 'cache-prune':
      await pruneCache(root);
      return;
    default:
      throw new Error('Usage: lint.ts {full|staged|diagnose|cache-status|cache-prune}');
  }
}

const entrypoint = resolve(process.argv[1] ?? '');
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
