/**
 * Structural invariants of the Athena dispatcher, asserted against the source itself.
 *
 * @remarks
 * Three of Athena's requirements are about code that must NOT exist: no second path that starts
 * tracked work, no entity mutation inside the conversational turn loop, no user-facing string
 * that calls a spawned agent a "sub" anything. A behavioural test cannot show the absence of a
 * call site — only a scan of the tree can — so these are deliberately source tests, and each one
 * states the rule it is protecting so a future reader knows what to do when it fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Repository root, derived from this file rather than from the working directory. */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Every `.ts`/`.tsx` file under a root, recursively. */
function sourceFiles(root: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Read a file relative to the repository root. */
function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** Strip block and line comments so a rule about code cannot be tripped by prose about code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('Athena is the single dispatcher for tracked work', () => {
  it('has exactly one module that claims work_linkage = task', () => {
    const claimants = sourceFiles(join(REPO_ROOT, 'apps', 'api', 'src')).filter((file) =>
      /workLinkage:\s*(taskId\s*\?|'task')/.test(withoutComments(readFileSync(file, 'utf8'))),
    );
    expect(claimants.map((file) => relative(REPO_ROOT, file))).toEqual([
      'apps/api/src/routes/agent-dispatch.ts',
    ]);
  });

  it('routes personal Athena work creation through the dispatcher, never around it', () => {
    const routes = read('apps/api/src/routes/me-athena.ts');
    expect(routes).toContain('dispatchAthenaWork');
    // The route file must not hand-assemble a `job` session; that is the dispatcher's job and
    // the only place the task-linkage claim can be made honestly.
    expect(withoutComments(routes)).not.toMatch(/kind:\s*'job'/);
  });

  it('gives every run generation a dispatch origin the database will accept', () => {
    const runs = sourceFiles(join(REPO_ROOT, 'apps', 'api', 'src'))
      .map((file) => ({ file, source: withoutComments(readFileSync(file, 'utf8')) }))
      .filter(({ source }) => /\.insert\(\s*agentSessionRun\s*\)/.test(source));
    expect(runs.length).toBeGreaterThan(0);
    for (const { file, source } of runs) {
      expect(
        source,
        `${relative(REPO_ROOT, file)} inserts a run without a dispatch origin`,
      ).toMatch(/dispatchOrigin:/);
    }
  });

  it('reaches spawned work from the interrupt, by walking the spawn edge', () => {
    const dispatcher = read('apps/api/src/routes/agent-dispatch.ts');
    expect(dispatcher).toContain('collectSpawnTree');
    expect(dispatcher).toContain('parentSessionId');
    expect(read('apps/api/src/routes/me-athena.ts')).toContain('interruptAthenaWork');
  });
});

describe('Athena herself is purely conversational', () => {
  /**
   * Modules that mutate Docket entities. A turn loop importing one of these would mean Athena
   * can change the world without a tool call and without a task — which is exactly what
   * "purely conversational" forbids.
   */
  const WRITE_REPOSITORIES = [
    'mcp/write-tools',
    'mcp/organize-tool',
    'mcp/content-tools',
    'lib/task-landing',
    'routes/agent-dispatch',
  ];

  it('keeps write repositories out of the turn handler’s import graph', () => {
    const loop = read('apps/api/src/agent/loop.ts');
    const imports = [...loop.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    for (const forbidden of WRITE_REPOSITORIES) {
      expect(
        imports.some((specifier) => specifier.includes(forbidden)),
        `agent/loop.ts must not import ${forbidden}`,
      ).toBe(false);
    }
  });

  it('writes only transcript and audit rows from the turn handler', () => {
    const loop = withoutComments(read('apps/api/src/agent/loop.ts'));
    const inserts = [...loop.matchAll(/\.insert\(\s*([A-Za-z_][\w]*)\s*\)/g)].map(
      (match) => match[1] ?? '',
    );
    const updates = [...loop.matchAll(/\.update\(\s*([A-Za-z_][\w]*)\s*\)/g)].map(
      (match) => match[1] ?? '',
    );
    const allowed = new Set(['sessionActivity', 'auditEvent', 'agentSession']);
    for (const table of [...inserts, ...updates]) {
      expect(allowed.has(table), `agent/loop.ts must not write ${table}`).toBe(true);
    }
  });
});

describe('spawned agents are Athena, not a second assistant', () => {
  it('has no user-facing “subagent” anywhere in the product surfaces', () => {
    const roots = [
      join(REPO_ROOT, 'apps', 'web', 'src'),
      join(REPO_ROOT, 'apps', 'admin', 'src'),
      join(REPO_ROOT, 'packages', 'ui', 'src'),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, 'utf8');
        // String literals only: a comment explaining why the word is banned must not fail the rule.
        for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
          if (/sub-?agents?/i.test(match[2] ?? '')) {
            offenders.push(`${relative(REPO_ROOT, file)}: ${match[0].slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names a spawned agent after the task it was spawned for, under Athena’s own name', () => {
    const bus = read('apps/api/src/routes/agent-bus.ts');
    expect(bus).toContain('`Athena · ${spawnLabel.trim()}`');
    expect(bus).toContain("'Athena'");
  });
});
