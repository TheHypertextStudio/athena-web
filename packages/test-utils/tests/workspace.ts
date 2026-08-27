import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const PACKAGE_JSON = 'package.json';
const SOURCE_GROUPS = new Set(['apps', 'domains', 'packages', 'services']);
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_LOCAL_TEST_DIRECTORIES = new Set(['__tests__', 'test', 'tests']);
const TEST_SOURCE_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const TYPE_DECLARATION_FILE = /\.d\.[cm]?ts$/;
const PRODUCTION_ENTRYPOINT_DIRECTORIES = new Set(['bin', 'build', 'scripts']);
const PRODUCTION_CONFIGURATION_FILE =
  /^(?:esbuild|next|postcss|rollup|tailwind|webpack|wrangler)\.config\.(?:[cm]?[jt]s|[jt]sx)$/;
const VITE_CONFIGURATION_FILE = /^vite\.config\.(?:[cm]?[jt]s|[jt]sx)$/;
const WORKSPACE_GROUPS = ['apps', 'domains', 'packages', 'services', 'tooling'] as const;

export const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');

export type DependencySection =
  'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';

export interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
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

/** Whether a path contains a conventional `__tests__`, `test`, or `tests` directory. */
export function hasConventionalTestDirectory(path: string): boolean {
  return path.split('/').some((pathSegment) => SOURCE_LOCAL_TEST_DIRECTORIES.has(pathSegment));
}

/** Whether a path sits in a conventional test directory beneath a package's `src` root. */
export function isSourceLocalTestPath(path: string, sourceDirectory: string): boolean {
  const sourcePrefix = `${sourceDirectory}/`;
  return (
    path.startsWith(sourcePrefix) && hasConventionalTestDirectory(path.slice(sourcePrefix.length))
  );
}

/** Whether a file is production TypeScript or JavaScript source that workspace policies scan. */
export function isProductionSourceFile(path: string): boolean {
  return (
    SOURCE_FILE.test(path) && !TEST_SOURCE_FILE.test(path) && !TYPE_DECLARATION_FILE.test(path)
  );
}

/** Return the root manifest plus every package manifest declared by the workspace globs. */
export function collectWorkspacePackages(): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [readWorkspacePackage(WORKSPACE_ROOT, null)];
  for (const group of WORKSPACE_GROUPS) {
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

/** Collect every non-test TypeScript or JavaScript source file under each product package's `src` directory. */
export function collectWorkspaceSourceFiles(): string[] {
  const files: string[] = [];
  for (const pkg of collectWorkspacePackages()) {
    if (pkg.group === null || !SOURCE_GROUPS.has(pkg.group)) continue;
    const srcDir = resolve(pkg.directory, 'src');
    if (!existsSync(srcDir)) continue;
    files.push(...collectPackageSourceFiles(srcDir));
  }
  return files;
}

/** Collect production source files from one package `src` directory. */
export function collectPackageSourceFiles(sourceDirectory: string): string[] {
  return collectSourceFiles(sourceDirectory, sourceDirectory);
}

/**
 * Whether a file is production build/configuration code owned by a workspace package.
 *
 * This deliberately includes the package's production configuration plus conventional build
 * entrypoint directories, rather than every root-level tool config. Test-runner configs have their
 * own lifecycle and are excluded; Vite config is included only when the package actually builds
 * with Vite.
 */
export function isPackageProductionEntrypointFile(
  filePath: string,
  packageDirectory: string,
  manifest: PackageManifest,
): boolean {
  const relativePath = relative(packageDirectory, filePath);
  if (
    relativePath === '' ||
    relativePath.startsWith('../') ||
    relativePath === '..' ||
    !isProductionSourceFile(relativePath) ||
    hasConventionalTestDirectory(relativePath)
  ) {
    return false;
  }

  const segments = relativePath.split('/');
  const firstSegment = segments[0];
  if (firstSegment === 'src') return false;
  if (firstSegment && PRODUCTION_ENTRYPOINT_DIRECTORIES.has(firstSegment)) return true;
  if (segments.length !== 1) return false;

  const fileName = basename(relativePath);
  if (PRODUCTION_CONFIGURATION_FILE.test(fileName)) return true;
  return VITE_CONFIGURATION_FILE.test(fileName) && usesViteBuild(manifest);
}

/** Collect a package's non-test production build/configuration entrypoints outside `src`. */
export function collectPackageProductionEntrypointFiles(
  packageDirectory: string,
  manifest: PackageManifest,
): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(packageDirectory, { withFileTypes: true })) {
    const entryPath = resolve(packageDirectory, entry.name);
    if (entry.isFile()) {
      if (isPackageProductionEntrypointFile(entryPath, packageDirectory, manifest)) {
        files.push(entryPath);
      }
      continue;
    }
    if (!entry.isDirectory() || !PRODUCTION_ENTRYPOINT_DIRECTORIES.has(entry.name)) continue;
    files.push(
      ...collectSourceFiles(entryPath, packageDirectory).filter((filePath) =>
        isPackageProductionEntrypointFile(filePath, packageDirectory, manifest),
      ),
    );
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

function collectSourceFiles(directory: string, sourceDirectory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isSourceLocalTestPath(entryPath, sourceDirectory)) {
        files.push(...collectSourceFiles(entryPath, sourceDirectory));
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isProductionSourceFile(entry.name)) continue;
    files.push(entryPath);
  }
  return files;
}

/**
 * Every file under `directory`, recursively, whose name ends with one of `extensions`.
 *
 * @remarks
 * The plain walk, for policy tests scanning something other than a package's production sources —
 * a docs content tree, say. Use {@link collectPackageSourceFiles} for shipped code; it also skips
 * source-local test directories and declaration files. Neither skips build output.
 *
 * @param directory - Absolute path to walk.
 * @param extensions - Suffixes to keep, e.g. `['.mdx', '.json']`.
 * @returns Absolute paths, in directory order.
 */
export function filesUnder(directory: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesUnder(entryPath, extensions));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!extensions.some((extension) => entry.name.endsWith(extension))) continue;
    files.push(entryPath);
  }
  return files;
}

function usesViteBuild(manifest: PackageManifest): boolean {
  const build = manifest.scripts?.['build'];
  return build !== undefined && /(?:^|[;&|\s])vite\s+build(?:\s|$)/.test(build);
}
