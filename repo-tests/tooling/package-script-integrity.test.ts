import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
});
