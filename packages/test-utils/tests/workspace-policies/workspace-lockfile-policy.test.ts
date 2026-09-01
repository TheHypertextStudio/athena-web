import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectWorkspacePackages,
  relativeToWorkspaceRoot,
  type WorkspacePackage,
  WORKSPACE_ROOT,
} from '../workspace';

const LOCKFILE_PATH = resolve(WORKSPACE_ROOT, 'pnpm-lock.yaml');
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const AUTOMATION_DIRECT_CONSUMER_MANIFESTS = [
  'apps/api/package.json',
  'apps/web/package.json',
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importerBlock(lockfile: string, importer: string): string | undefined {
  const heading = `  ${importer}:\n`;
  const start = lockfile.indexOf(heading);
  if (start === -1) return undefined;

  const afterHeading = lockfile.slice(start + heading.length);
  const nextHeading = afterHeading.search(/^[ ]{2}\S.*:\n/m);
  return nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
}

function workspaceLockfileViolations(
  lockfile: string,
  packages: readonly WorkspacePackage[],
): string[] {
  const violations: string[] = [];

  for (const workspacePackage of packages) {
    const importer = workspacePackage.group
      ? relativeToWorkspaceRoot(workspacePackage.directory)
      : '.';
    const declaredWorkspaceDependencies = new Set(
      DEPENDENCY_SECTIONS.flatMap((section) =>
        Object.entries(workspacePackage.manifest[section] ?? {})
          .filter(([, specifier]) => specifier.startsWith('workspace:'))
          .map(([dependency]) => dependency),
      ),
    );
    const block = importerBlock(lockfile, importer);
    if (!block) {
      if (declaredWorkspaceDependencies.size > 0) {
        violations.push(`${importer} is missing from pnpm-lock.yaml importers`);
      }
      continue;
    }

    for (const section of DEPENDENCY_SECTIONS) {
      for (const [dependency, specifier] of Object.entries(
        workspacePackage.manifest[section] ?? {},
      )) {
        if (!specifier.startsWith('workspace:')) continue;
        const entry = new RegExp(
          `^[ ]{6}(?:'${escapeRegex(dependency)}'|${escapeRegex(dependency)}):\\n` +
            `[ ]{8}specifier: ${escapeRegex(specifier)}\\n` +
            '[ ]{8}version: link:',
          'm',
        );
        if (!entry.test(block)) {
          violations.push(
            `${relativeToWorkspaceRoot(workspacePackage.manifestPath)} ` +
              `${section}.${dependency} is absent from its pnpm-lock.yaml importer`,
          );
        }
      }
    }

    const lockedWorkspaceDependencies = [
      ...block.matchAll(
        /^[ ]{6}'?([^'\n:]+)'?:\n[ ]{8}specifier: workspace:[^\n]+\n[ ]{8}version: link:/gm,
      ),
    ].map((match) => match[1]);
    for (const dependency of lockedWorkspaceDependencies) {
      if (!dependency || declaredWorkspaceDependencies.has(dependency)) continue;
      violations.push(
        `${relativeToWorkspaceRoot(workspacePackage.manifestPath)} ` +
          `pnpm-lock.yaml declares undeclared workspace dependency ${dependency}`,
      );
    }
  }

  return violations.sort();
}

describe('workspace lockfile policy', () => {
  it('detects a workspace dependency that a lockfile importer omits', () => {
    const fixture = {
      directory: resolve(WORKSPACE_ROOT, 'apps', 'web'),
      group: 'apps',
      manifest: {
        dependencies: { '@docket/athena': 'workspace:*', '@docket/types': 'workspace:*' },
      },
      manifestPath: resolve(WORKSPACE_ROOT, 'apps', 'web', 'package.json'),
    } as const satisfies WorkspacePackage;
    const lockfile = `lockfileVersion: '9.0'\n\nimporters:\n\n  apps/web:\n    dependencies:\n      '@docket/types':\n        specifier: workspace:*\n        version: link:../../packages/types\n`;

    expect(workspaceLockfileViolations(lockfile, [fixture])).toEqual([
      'apps/web/package.json dependencies.@docket/athena is absent from its pnpm-lock.yaml importer',
    ]);
  });

  it('detects a workspace link that the manifest does not declare', () => {
    const fixture = {
      directory: resolve(WORKSPACE_ROOT, 'apps', 'web'),
      group: 'apps',
      manifest: { dependencies: {} },
      manifestPath: resolve(WORKSPACE_ROOT, 'apps', 'web', 'package.json'),
    } as const satisfies WorkspacePackage;
    const lockfile = `lockfileVersion: '9.0'\n\nimporters:\n\n  apps/web:\n    dependencies:\n      '@docket/athena':\n        specifier: workspace:*\n        version: link:../../domains/athena\n`;

    expect(workspaceLockfileViolations(lockfile, [fixture])).toEqual([
      'apps/web/package.json pnpm-lock.yaml declares undeclared workspace dependency @docket/athena',
    ]);
  });

  it('keeps every direct Automation grammar consumer declared and linked', () => {
    const allPackages = collectWorkspacePackages();
    const consumers = AUTOMATION_DIRECT_CONSUMER_MANIFESTS.map((manifestPath) =>
      allPackages.find(
        (workspacePackage) =>
          relativeToWorkspaceRoot(workspacePackage.manifestPath) === manifestPath,
      ),
    );

    expect(consumers.every((consumer) => consumer !== undefined)).toBe(true);
    for (const consumer of consumers) {
      expect(consumer?.manifest.dependencies?.['@docket/automation']).toBe('workspace:*');
    }

    const declaredConsumers = consumers.filter(
      (consumer): consumer is WorkspacePackage => consumer !== undefined,
    );
    const violations = workspaceLockfileViolations(
      readFileSync(LOCKFILE_PATH, 'utf8'),
      declaredConsumers,
    );

    expect(
      violations,
      `Automation's direct grammar consumers must retain matching lockfile importers:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps every declared workspace dependency represented by a local lockfile link', () => {
    const violations = workspaceLockfileViolations(
      readFileSync(LOCKFILE_PATH, 'utf8'),
      collectWorkspacePackages(),
    );

    expect(
      violations,
      `Run pnpm install after changing workspace dependencies:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
