import type { Stats } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';

/** An unchanged native collector entry, including its original link text or mode. */
export type MappedEntry =
  | { relative: string; kind: 'symlink'; link: string }
  | { relative: string; kind: 'file' | 'directory'; mode: number };

interface MappedContext {
  root: string;
  credential: string | undefined;
  unsafePath: (value: string) => boolean;
  inspectFile: (file: string, recordNative?: boolean) => Promise<void>;
  explicitPaths: Set<string>;
  entries: Map<string, MappedEntry>;
  audited: Set<string>;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safePath(context: MappedContext, relative: string): string {
  const source = path.resolve(context.root, relative);
  if (path.isAbsolute(relative) || !inside(context.root, source) || context.unsafePath(relative)) {
    throw new Error('Unsafe mapped dependency');
  }
  return source;
}

async function checkedLink(context: MappedContext, source: string): Promise<string> {
  const link = await readlink(source);
  if (context.credential && link.includes(context.credential)) {
    throw new Error('Job credential found in mapped symlink');
  }
  if (path.isAbsolute(link)) throw new Error('Absolute mapped symlink');
  return link;
}

async function addEntry(
  context: MappedContext,
  relative: string,
  active = new Set<string>(),
): Promise<void> {
  if (!relative || relative === '.') return;
  const source = safePath(context, relative);
  const key = path.relative(context.root, source);
  if (active.has(key)) throw new Error('Mapped symlink cycle');
  if (context.entries.has(key)) return;
  const next = new Set(active).add(key);
  const info = await lstat(source);
  const canonical = await realpath(source);
  if (!inside(context.root, canonical)) throw new Error('Escaping mapped dependency');
  safePath(context, path.relative(context.root, canonical));
  await addEntry(context, path.dirname(key), next);
  if (info.isSymbolicLink()) {
    const link = await checkedLink(context, source);
    const target = path.relative(context.root, path.resolve(path.dirname(source), link));
    safePath(context, target);
    await addEntry(context, target, next);
    context.entries.set(key, { relative: key, kind: 'symlink', link });
  } else if (info.isDirectory()) {
    context.entries.set(key, { relative: key, kind: 'directory', mode: info.mode & 0o777 });
  } else if (info.isFile()) {
    if (!context.explicitPaths.has(key)) throw new Error('Untraced mapped symlink file target');
    await context.inspectFile(source);
    context.entries.set(key, { relative: key, kind: 'file', mode: info.mode & 0o777 });
  } else throw new Error('Unsupported mapped dependency type');
}

// Audit complete target trees, but copy only native references and their parent/link entries.
// Mark a canonical target complete only after its descendants pass; active cycles still fail.
async function auditTree(
  context: MappedContext,
  source: string,
  active = new Set<string>(),
): Promise<void> {
  safePath(context, path.relative(context.root, source));
  const info = await lstat(source);
  const canonical = await realpath(source);
  if (!inside(context.root, canonical)) throw new Error('Escaping mapped dependency');
  safePath(context, path.relative(context.root, canonical));
  if (info.isSymbolicLink()) await checkedLink(context, source);
  if (active.has(canonical)) throw new Error('Mapped target cycle');
  if (context.audited.has(canonical)) return;
  const target = await stat(source);
  if (target.isDirectory()) {
    const next = new Set(active).add(canonical);
    for (const name of await readdir(source))
      await auditTree(context, path.join(source, name), next);
  } else if (target.isFile()) await context.inspectFile(source, false);
  else throw new Error('Unsupported mapped dependency type');
  context.audited.add(canonical);
}

function fileKind(info: Stats | null): string {
  if (info?.isSymbolicLink()) return 'symlink';
  if (info?.isDirectory()) return 'directory';
  return info?.isFile() ? 'file' : 'missing-or-other';
}

async function failure(
  context: MappedContext,
  value: string,
  config: string | undefined,
  error: unknown,
): Promise<Error> {
  const source = path.resolve(context.root, value);
  const info = await lstat(source).catch(() => null);
  const canonical = await realpath(source).catch(() => null);
  const diagnostic = {
    config: config?.slice(0, 512),
    source: value.slice(0, 512),
    type: fileKind(info),
    symlink: info?.isSymbolicLink() ? (await readlink(source)).slice(0, 512) : null,
    canonicalWithinRoot: canonical ? inside(context.root, canonical) : null,
  };
  if (context.credential && JSON.stringify(diagnostic).includes(context.credential)) {
    return new Error('Job credential found in mapped dependency metadata');
  }
  const reason =
    error instanceof Error
      ? error.message.replaceAll(context.root, '<release-root>')
      : 'Unknown failure';
  return new Error(`Invalid mapped dependency ${JSON.stringify(diagnostic)}: ${reason}`, {
    cause: error,
  });
}

/**
 * Audits native mapped entries and preserves only their explicit parent/link closure.
 * @param root - Canonical release root.
 * @param references - Native adapter paths, kept unchanged.
 * @param configs - Config-relative provenance for bounded failure diagnostics.
 * @param options - Existing credential/path/native guards used for every required entry.
 * @returns Ordered entries whose parents and link targets precede their dependents.
 * @throws If a target escapes, cycles, is untraced, or fails a credential/native guard.
 */
export async function collectMappedEntries(
  root: string,
  references: string[],
  configs: Map<string, string>,
  options: Pick<MappedContext, 'credential' | 'unsafePath' | 'inspectFile'>,
): Promise<MappedEntry[]> {
  const context: MappedContext = {
    root,
    ...options,
    explicitPaths: new Set(
      references.map((value) => path.relative(root, path.resolve(root, value))),
    ),
    entries: new Map(),
    audited: new Set(),
  };
  for (const value of references) {
    try {
      await addEntry(context, value);
      await auditTree(context, path.resolve(root, value));
    } catch (error) {
      throw await failure(context, value, configs.get(value), error);
    }
  }
  return [...context.entries.values()];
}

async function copyLink(target: string, link: string): Promise<void> {
  const existing = await lstat(target).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    return null;
  });
  if (!existing) await symlink(link, target);
  else if (!existing.isSymbolicLink() || (await readlink(target)) !== link) {
    throw new Error('Conflicting staged mapped symlink');
  }
}

/**
 * Copies audited entries with native link text and modes, without adding untraced files.
 * @param root - Original native build root.
 * @param stage - Reconstructed release root to audit before packaging.
 * @param files - Entries returned by the native-reference audit.
 * @throws If an existing staged link conflicts with the native source.
 */
export async function copyMappedReferences(
  root: string,
  stage: string,
  files: { entries: MappedEntry[] },
): Promise<void> {
  for (const entry of files.entries) {
    const target = path.join(stage, entry.relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (entry.kind === 'symlink') await copyLink(target, entry.link);
    else if (entry.kind === 'directory') {
      await mkdir(target, { recursive: true });
      await chmod(target, entry.mode);
    } else {
      await copyFile(path.join(root, entry.relative), target);
      await chmod(target, entry.mode);
    }
  }
}
