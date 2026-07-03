import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PACKAGE_JSON = 'package.json';
const SOURCE_GROUPS = new Set(['apps', 'packages']);

export const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');

export type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface WorkspacePackage {
  directory: string;
  group: string | null;
  manifest: PackageManifest;
  manifestPath: string;
}

/** Return a path relative to the workspace root for readable policy-test failures. */
export function relativeToWorkspaceRoot(path: string): string {
  return path.replace(`${WORKSPACE_ROOT}/`, '');
}

/** Return the root manifest plus every package manifest declared by the workspace globs. */
export function collectWorkspacePackages(): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [readWorkspacePackage(WORKSPACE_ROOT, null)];
  for (const group of ['apps', 'packages', 'tooling']) {
    const base = resolve(WORKSPACE_ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const directory = resolve(base, entry.name);
        const manifestPath = resolve(directory, PACKAGE_JSON);
        if (existsSync(manifestPath)) packages.push(readWorkspacePackage(directory, group));
      }
    }
  }
  return packages;
}

/** Collect every non-test `.ts`/`.tsx` source file under each app/package `src` directory. */
export function collectWorkspaceSourceFiles(): string[] {
  const files: string[] = [];
  for (const pkg of collectWorkspacePackages()) {
    if (pkg.group === null || !SOURCE_GROUPS.has(pkg.group)) continue;
    const srcDir = resolve(pkg.directory, 'src');
    if (!existsSync(srcDir)) continue;
    files.push(...collectSourceFiles(srcDir));
  }
  return files;
}

function readWorkspacePackage(directory: string, group: string | null): WorkspacePackage {
  const manifestPath = resolve(directory, PACKAGE_JSON);
  return {
    directory,
    group,
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest,
    manifestPath,
  };
}

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    files.push(entryPath);
  }
  return files;
}
