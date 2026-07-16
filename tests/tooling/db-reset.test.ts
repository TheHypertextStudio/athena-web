import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeDatabaseReset, planDatabaseReset, type ResetCommand } from '../../scripts/db-reset';

const cleanupRoots: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'docket-db-reset-'));
  cleanupRoots.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('database reset planning', () => {
  it('targets only a nested repo-local PGlite directory', async () => {
    const workspaceRoot = await temporaryWorkspace();

    expect(
      planDatabaseReset({
        databaseUrl: 'pglite://.data/review-reset',
        workspaceRoot,
      }),
    ).toEqual({
      kind: 'pglite',
      dataDir: resolve(workspaceRoot, '.data/review-reset'),
      workspaceRoot,
    });
  });

  it.each([
    ['the data root', 'pglite://.data'],
    ['a traversal outside data', 'pglite://.data/../other'],
    ['an absolute path', 'pglite:///tmp/docket-review-reset'],
  ])('rejects %s', async (_label, databaseUrl) => {
    const workspaceRoot = await temporaryWorkspace();

    expect(() => planDatabaseReset({ databaseUrl, workspaceRoot })).toThrow(
      /nested under the repository \.data directory/,
    );
  });

  it('allows only the exact local Docker Compose database', async () => {
    const workspaceRoot = await temporaryWorkspace();

    expect(
      planDatabaseReset({
        databaseUrl: 'postgres://docket:docket@localhost:5433/docket',
        workspaceRoot,
      }),
    ).toEqual({ kind: 'docker', workspaceRoot });
    expect(() =>
      planDatabaseReset({
        databaseUrl: 'postgres://docket:docket@db.example.com:5432/docket',
        workspaceRoot,
      }),
    ).toThrow(/refuses remote or nonstandard Postgres/);
    expect(() =>
      planDatabaseReset({
        databaseUrl: 'neon://user:secret@example.neon.tech/docket',
        workspaceRoot,
      }),
    ).toThrow(/refuses remote or nonstandard Postgres/);
  });

  it('refuses every reset in a production runtime', async () => {
    const workspaceRoot = await temporaryWorkspace();

    expect(() =>
      planDatabaseReset({
        appMode: 'production',
        databaseUrl: 'pglite://.data/review-reset',
        workspaceRoot,
      }),
    ).toThrow(/disabled in production/);
  });
});

describe('database reset execution', () => {
  it('revalidates the deletion boundary when executing a supplied plan', async () => {
    const workspaceRoot = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    writeFileSync(resolve(outside, 'sentinel'), 'keep');
    const run = vi.fn();

    await expect(
      executeDatabaseReset({ kind: 'pglite', dataDir: outside, workspaceRoot }, { run }),
    ).rejects.toThrow(/nested under the repository \.data directory/);

    expect(readFileSync(resolve(outside, 'sentinel'), 'utf8')).toBe('keep');
    expect(run).not.toHaveBeenCalled();
  });

  it('deletes only the selected PGlite directory and runs fresh migrations', async () => {
    const workspaceRoot = await temporaryWorkspace();
    const selected = resolve(workspaceRoot, '.data/review-reset');
    const sibling = resolve(workspaceRoot, '.data/keep-me');
    mkdirSync(selected, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(resolve(selected, 'old-data'), 'remove');
    writeFileSync(resolve(sibling, 'sentinel'), 'keep');
    const commands: ResetCommand[] = [];

    await executeDatabaseReset(
      { kind: 'pglite', dataDir: selected, workspaceRoot },
      {
        run: (command) => {
          commands.push(command);
        },
      },
    );

    expect(existsSync(selected)).toBe(false);
    expect(readFileSync(resolve(sibling, 'sentinel'), 'utf8')).toBe('keep');
    expect(commands).toEqual([{ command: 'pnpm', args: ['db:migrate'] }]);
  });

  it('refuses a symlinked PGlite target without touching its destination', async () => {
    const workspaceRoot = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    const dataRoot = resolve(workspaceRoot, '.data');
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(resolve(outside, 'sentinel'), 'keep');
    symlinkSync(outside, resolve(dataRoot, 'review-reset'));
    const run = vi.fn();

    await expect(
      executeDatabaseReset(
        {
          kind: 'pglite',
          dataDir: resolve(dataRoot, 'review-reset'),
          workspaceRoot,
        },
        { run },
      ),
    ).rejects.toThrow(/symbolic link/);

    expect(readFileSync(resolve(outside, 'sentinel'), 'utf8')).toBe('keep');
    expect(run).not.toHaveBeenCalled();
  });

  it('removes the Compose volume before migrating the exact local Docker database', async () => {
    const workspaceRoot = await temporaryWorkspace();
    const commands: ResetCommand[] = [];

    await executeDatabaseReset(
      { kind: 'docker', workspaceRoot },
      {
        run: (command) => {
          commands.push(command);
        },
      },
    );

    expect(commands).toEqual([
      { command: 'docker', args: ['compose', 'down', '-v'] },
      { command: 'pnpm', args: ['db:migrate'] },
    ]);
  });
});
