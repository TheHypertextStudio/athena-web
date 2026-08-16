import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Repository root, derived from this file's location. */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A turbo task node as reported by `turbo run <task> --dry=json`. */
interface DryRunTask {
  readonly taskId: string;
  readonly command: string;
}

/** The subset of `turbo run --dry=json` output this suite asserts over. */
interface DryRun {
  /** Workspaces the filter selected — the *affected set*. */
  readonly packages: readonly string[];
  /** Every node in the resulting task graph, including ones with no script to run. */
  readonly tasks: readonly DryRunTask[];
}

/**
 * Turbo's placeholder for a graph node whose package declares no such script.
 *
 * @remarks
 * `--dry=json` reports one node per package in the closure regardless of whether it
 * actually has the task. Workspace packages here ship raw TypeScript (`"types":
 * "./src/index.ts"` — see turbo.json), so most have no `build` script at all and
 * appear only as placeholders. Filtering them out is what separates "packages in
 * the graph" from "work that actually executes".
 */
const NO_SCRIPT = '<NONEXISTENT>';

/**
 * Runs `turbo run build --dry=json` under a filter and returns the parsed plan.
 *
 * @param filter - A turbo filter expression, e.g. `...@docket/ui`
 * @returns The affected package set and the tasks turbo would execute
 */
function planBuild(filter: string): { packages: string[]; executed: string[] } {
  const stdout = execFileSync(
    join(REPO_ROOT, 'node_modules', '.bin', 'turbo'),
    ['run', 'build', '--dry=json', `--filter=${filter}`],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // The dry run only reads the task graph, never a package's env contract; pinning this
      // keeps the plan identical whether or not a shell happens to export production values.
      env: { ...process.env, SKIP_ENV_VALIDATION: '1' },
    },
  );
  const plan = JSON.parse(stdout) as DryRun;
  return {
    packages: [...plan.packages].sort(),
    executed: plan.tasks
      .filter((task) => task.command !== '' && task.command !== NO_SCRIPT)
      .map((task) => task.taskId)
      .sort(),
  };
}

/**
 * A change in one package must not force unrelated packages to rebuild.
 *
 * @remarks
 * `--filter=...<pkg>` selects `<pkg>` plus everything that depends on it, which is
 * exactly the set a change inside `<pkg>` can affect. The expectations below are the
 * *committed* affected sets: if a new dependency edge drags an unrelated workspace
 * into either set, these assertions fail and the edge has to be justified.
 *
 * The executed-task list is a superset of the affected packages because `build`
 * declares `dependsOn: ["^build"]`, so a dependency's build node is scheduled ahead of
 * its dependent's. Those prerequisites are replayed from cache when their inputs are
 * unchanged, so they cost nothing — but they are asserted too, because a new
 * *executing* prerequisite is exactly the regression this check exists to catch.
 */
describe('turbo build affected sets', () => {
  it('confines an apps/web/src change to @docket/web', () => {
    const plan = planBuild('...@docket/web');

    // Nothing in the monorepo depends on the web app, so it is the whole affected set.
    expect(plan.packages).toEqual(['@docket/web']);
    expect(plan.executed).toEqual(['@docket/api#build', '@docket/web#build']);
  });

  it('confines a packages/ui change to @docket/ui and the two apps that consume it', () => {
    const plan = planBuild('...@docket/ui');

    expect(plan.packages).toEqual(['@docket/admin', '@docket/ui', '@docket/web']);
    // @docket/ui itself has no build task (it ships raw TS); its two dependents do.
    expect(plan.executed).toEqual([
      '@docket/admin#build',
      '@docket/api#build',
      '@docket/web#build',
    ]);
  });

  it('keeps the two affected sets distinct — a web change never reaches admin', () => {
    const web = planBuild('...@docket/web');
    const ui = planBuild('...@docket/ui');

    expect(web.packages).not.toContain('@docket/admin');
    expect(web.executed).not.toContain('@docket/admin#build');
    expect(ui.packages.length).toBeGreaterThan(web.packages.length);
  });
});
