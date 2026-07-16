/**
 * Safely reset the configured local development database and replay all migrations.
 *
 * @remarks
 * PGlite resets are restricted to a nested path under this repository's `.data` directory.
 * PostgreSQL resets are restricted to the exact Docker Compose development database. Remote,
 * production, root-directory, traversal, and symlinked targets fail closed before deletion.
 */
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A subprocess invocation performed during database reset. */
export interface ResetCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** A reset target that passed the production, scheme, and path safety checks. */
export type DatabaseResetPlan =
  | {
      readonly kind: 'pglite';
      readonly dataDir: string;
      readonly workspaceRoot: string;
    }
  | {
      readonly kind: 'pglite-memory';
      readonly workspaceRoot: string;
    }
  | {
      readonly kind: 'docker';
      readonly workspaceRoot: string;
    };

/** Inputs used to derive a safe database reset plan. */
export interface DatabaseResetOptions {
  readonly appMode?: string;
  readonly databaseUrl: string;
  readonly nodeEnv?: string;
  readonly workspaceRoot: string;
}

/** Injectable command boundary used by reset tests. */
export interface DatabaseResetDependencies {
  readonly run?: (command: ResetCommand) => void | Promise<void>;
}

function isProductionRuntime(options: DatabaseResetOptions): boolean {
  return [options.appMode, options.nodeEnv].some((value) => value?.toLowerCase() === 'production');
}

function pglitePath(databaseUrl: string, root: string): string | null {
  const path = databaseUrl.replace(/^pglite:(\/\/)?/, '');
  if (!path || path === 'memory' || path === ':memory:' || path === 'memory://') return null;
  return isAbsolute(path) ? resolve(path) : resolve(root, path);
}

function isNestedPath(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== '' && !pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..';
}

function isLocalComposeUrl(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  return (
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    localHosts.has(url.hostname) &&
    url.port === '5433' &&
    url.username === 'docket' &&
    url.pathname === '/docket'
  );
}

/**
 * Derive the only reset operation permitted for a configured database URL.
 *
 * @param options - Runtime mode, database URL, and trusted repository root.
 * @returns a validated reset plan that can be executed without reinterpreting the URL.
 * @throws When the target is production, remote, unsupported, or outside the repository data root.
 */
export function planDatabaseReset(options: DatabaseResetOptions): DatabaseResetPlan {
  if (isProductionRuntime(options)) {
    throw new Error('db:reset is disabled in production runtimes.');
  }

  const root = resolve(options.workspaceRoot);
  if (options.databaseUrl.startsWith('pglite:')) {
    const dataDir = pglitePath(options.databaseUrl, root);
    if (dataDir === null) return { kind: 'pglite-memory', workspaceRoot: root };

    const dataRoot = resolve(root, '.data');
    if (!isNestedPath(dataRoot, dataDir)) {
      throw new Error('PGlite reset targets must be nested under the repository .data directory.');
    }
    return { kind: 'pglite', dataDir, workspaceRoot: root };
  }

  if (!isLocalComposeUrl(options.databaseUrl)) {
    throw new Error(
      'db:reset refuses remote or nonstandard Postgres targets; use the exact local Docker Compose database.',
    );
  }
  return { kind: 'docker', workspaceRoot: root };
}

function assertNoSymlinks(plan: Extract<DatabaseResetPlan, { kind: 'pglite' }>): void {
  const dataRoot = resolve(plan.workspaceRoot, '.data');
  if (!isNestedPath(dataRoot, resolve(plan.dataDir))) {
    throw new Error('PGlite reset targets must be nested under the repository .data directory.');
  }
  const segments = relative(dataRoot, plan.dataDir).split(sep).filter(Boolean);
  let current = dataRoot;
  for (const segment of ['', ...segments]) {
    if (segment) current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`db:reset refuses symbolic link paths under .data: ${current}`);
    }
  }
}

function runResetCommand(resetCommand: ResetCommand): void {
  const result = spawnSync(resetCommand.command, [...resetCommand.args], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${resetCommand.command} ${resetCommand.args.join(' ')} failed with status ${String(result.status)}`,
    );
  }
}

/**
 * Execute a previously validated reset plan and replay migrations.
 *
 * @param plan - Safe target returned by {@link planDatabaseReset}.
 * @param dependencies - Optional command runner used by tests.
 */
export async function executeDatabaseReset(
  plan: DatabaseResetPlan,
  dependencies: DatabaseResetDependencies = {},
): Promise<void> {
  const run = dependencies.run ?? runResetCommand;

  if (plan.kind === 'pglite') {
    assertNoSymlinks(plan);
    rmSync(plan.dataDir, { force: true, recursive: true });
    console.log(`✓ removed PGlite database ${relative(plan.workspaceRoot, plan.dataDir)}`);
  } else if (plan.kind === 'pglite-memory') {
    console.log('✓ PGlite is in-memory; no persisted database to remove.');
  } else {
    await run({ command: 'docker', args: ['compose', 'down', '-v'] });
    console.log('✓ removed local Docker Compose database volume');
  }

  await run({ command: 'pnpm', args: ['db:migrate'] });
}

/** Reset the configured development database from the command line. */
export async function main(): Promise<void> {
  const unpooled = process.env['DATABASE_URL_UNPOOLED'];
  const databaseUrl =
    unpooled !== undefined && unpooled !== '' ? unpooled : process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for db:reset.');

  const plan = planDatabaseReset({
    appMode: process.env['APP_MODE'],
    databaseUrl,
    nodeEnv: process.env.NODE_ENV,
    workspaceRoot,
  });
  await executeDatabaseReset(plan);
  console.log('✓ database reset complete');
}

/* v8 ignore start -- CLI process boundary is covered through exported planning/execution helpers. */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
/* v8 ignore stop */
