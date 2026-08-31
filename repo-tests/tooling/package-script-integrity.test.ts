import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const workspaceRoot = resolve(import.meta.dirname, '../..');
const workspaceGroups = ['apps', 'domains', 'packages', 'services', 'tooling'] as const;

function workspaceManifests(): readonly string[] {
  const manifests = [join(workspaceRoot, 'package.json')];
  for (const group of workspaceGroups) {
    const groupPath = join(workspaceRoot, group);
    if (!existsSync(groupPath)) continue;
    for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(groupPath, entry.name, 'package.json');
      if (existsSync(manifestPath)) manifests.push(manifestPath);
    }
  }
  return manifests;
}

describe('workspace package scripts', () => {
  it('never advertises an echo-only placeholder as a successful command', () => {
    const placeholders = workspaceManifests().flatMap((manifestPath) => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
      return Object.entries(manifest.scripts ?? {}).flatMap(([name, command]) =>
        /^\s*echo(?:\s|$)/u.test(command)
          ? [`${relative(workspaceRoot, manifestPath)}#${name}`]
          : [],
      );
    });

    expect(placeholders).toEqual([]);
  });

  /**
   * CI's only test job runs `turbo run test:coverage` — no workflow runs `turbo run test`. A
   * package that ships tests but declares no `test:coverage` script is reported by turbo as
   * `<NONEXISTENT>` and skipped in silence, so its suites never execute in CI at all.
   *
   * `@docket/admin` and `@docket/runner` were both through this gap, taking 10 test files with
   * them. The `rest` shard is defined by exclusion so a new *package* cannot escape the gates,
   * but that protects against a missing filter, never a missing script. This does.
   */
  it('runs every package that ships tests under the task CI actually gates on', () => {
    const ungated = workspaceManifests().flatMap((manifestPath) => {
      if (!existsSync(join(dirname(manifestPath), 'tests'))) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
      return manifest.scripts?.['test:coverage'] ? [] : [relative(workspaceRoot, manifestPath)];
    });

    expect(ungated).toEqual([]);
  });
});
