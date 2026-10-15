import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectMappedEntries,
  copyMappedReferences,
  type MappedEntry,
} from './lib/vercel-mapped-references';

export { copyMappedReferences };

interface ArtifactFiles {
  references: string[];
  entries: MappedEntry[];
  nativeFiles: { file: string; sha256: string }[];
}

interface ArtifactContext {
  root: string;
  output: string;
  credential: string | undefined;
  references: Set<string>;
  referenceConfigs: Map<string, string>;
  nativeFiles: Map<string, string>;
  seen: Set<string>;
}

const PUBLIC_AUTH_KEYS = new Set([
  'BETTER_AUTH_PASSKEY_RP_ID',
  'BETTER_AUTH_PASSKEY_LEGACY_RP_ID',
  'BETTER_AUTH_ALLOWED_HOSTS',
]);
const MACH_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
]);

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function credentialPath(value: string): boolean {
  return value
    .split(/[\\/]/)
    .some(
      (part) =>
        ['.git', '.npmrc', 'credentials.json', 'auth.json'].includes(part) ||
        part.startsWith('.env'),
    );
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid native function configuration');
  }
  return value as Record<string, unknown>;
}

function isLinuxNative(file: string, bytes: Buffer): boolean {
  const magic = bytes.length >= 4 ? bytes.readUInt32BE(0) : 0;
  const elf = magic === 0x7f454c46;
  const native = elf || MACH_MAGICS.has(magic) || /\.(node|so(?:\.\d+)*|dylib)$/.test(file);
  if (!native) return false;
  if (
    !elf ||
    bytes.length < 20 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== 62
  ) {
    throw new Error('Expected Linux x64 ELF');
  }
  return true;
}

async function inspectFile(
  context: ArtifactContext,
  file: string,
  recordNative = true,
): Promise<void> {
  const relative = path.relative(context.root, file);
  if (credentialPath(relative)) throw new Error('Unsafe credential file in artifact output');
  const bytes = await readFile(file);
  if (context.credential && bytes.includes(Buffer.from(context.credential))) {
    throw new Error('Job credential found in artifact contents');
  }
  if (isLinuxNative(file, bytes) && recordNative) {
    context.nativeFiles.set(relative, createHash('sha256').update(bytes).digest('hex'));
  }
}

function validateFunction(config: Record<string, unknown>): void {
  const environment = record(config['environment'] ?? {});
  const hasCredential = Object.keys(environment).some(
    (key) => /token|secret|password|auth/i.test(key) && !PUBLIC_AUTH_KEYS.has(key),
  );
  if (hasCredential) throw new Error('Unexpected credential in function environment');
  if (config['architecture'] && config['architecture'] !== 'x86_64') {
    throw new Error('Incompatible function architecture');
  }
  const runtime = config['runtime'];
  if (typeof runtime === 'string' && runtime.startsWith('nodejs') && runtime !== 'nodejs24.x') {
    throw new Error('Unexpected function runtime');
  }
}

async function collectReferences(
  context: ArtifactContext,
  config: Record<string, unknown>,
  configFile: string,
): Promise<void> {
  for (const value of Object.values(record(config['filePathMap'] ?? {}))) {
    if (typeof value !== 'string' || path.isAbsolute(value)) {
      throw new Error('Invalid mapped dependency path');
    }
    const source = path.resolve(context.root, value);
    if (!inside(context.root, source) || credentialPath(value)) {
      throw new Error('Unsafe mapped dependency');
    }
    context.references.add(value);
    context.referenceConfigs.set(value, path.relative(context.root, configFile));
  }
}

async function validateOutputLink(context: ArtifactContext, file: string): Promise<void> {
  if (context.credential && (await readlink(file)).includes(context.credential)) {
    throw new Error('Job credential found in output symlink');
  }
  if (!inside(context.output, await realpath(file))) throw new Error('Escaping output symlink');
}

async function walkArtifact(context: ArtifactContext, directory: string): Promise<void> {
  const canonical = await realpath(directory);
  if (context.seen.has(canonical)) return;
  context.seen.add(canonical);
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name);
    if (credentialPath(path.relative(context.root, file)))
      throw new Error('Unsafe credential file');
    const info = await lstat(file);
    if (info.isSymbolicLink()) await validateOutputLink(context, file);
    if ((await stat(file)).isDirectory()) {
      await walkArtifact(context, file);
      continue;
    }
    await inspectFile(context, file);
    if (name !== '.vc-config.json') continue;
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    const config = record(value);
    validateFunction(config);
    await collectReferences(context, config, file);
  }
}

/**
 * Collects the native Vercel adapter's exact file references without changing its output maps.
 * @param root - Checkout or extracted artifact root containing `.vercel/output`.
 * @param options - The automatic job credential to reject if it appears in artifact bytes.
 * @returns Traced paths and hashes of verified Linux x64 native files.
 * @throws When files escape the root, contain credentials, or target an incompatible runtime.
 */
export async function collectArtifactFiles(
  root: string,
  options: { credential?: string } = {},
): Promise<ArtifactFiles> {
  const canonical = await realpath(root);
  const context: ArtifactContext = {
    root: canonical,
    output: path.join(canonical, '.vercel/output'),
    credential: options.credential,
    references: new Set(),
    referenceConfigs: new Map(),
    nativeFiles: new Map(),
    seen: new Set(),
  };
  await walkArtifact(context, context.output);
  const references = [...context.references].sort();
  const entries = await collectMappedEntries(canonical, references, context.referenceConfigs, {
    credential: context.credential,
    unsafePath: credentialPath,
    inspectFile: (file, recordNative) => inspectFile(context, file, recordNative),
  });
  return {
    references,
    entries,
    nativeFiles: [...context.nativeFiles].map(([file, sha256]) => ({ file, sha256 })),
  };
}

async function checkProjectMetadata(root: string, credential: string): Promise<void> {
  const bytes = await readFile(path.join(root, '.vercel/project.json'));
  if (bytes.includes(Buffer.from(credential)))
    throw new Error('Job credential found in project metadata');
}

async function packageArtifact(destination: string): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Release artifacts require a Linux x64 builder');
  }
  const root = process.cwd();
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (sourceSha !== process.env['GITHUB_SHA'])
    throw new Error('Source does not match the workflow revision');
  const credential = process.env['ARTIFACT_JOB_TOKEN'];
  if (!credential) throw new Error('Artifact credential guard is unavailable');
  const files = await collectArtifactFiles(root, { credential });
  await checkProjectMetadata(root, credential);
  const stage = await mkdtemp(path.join(tmpdir(), 'docket-release-'));
  try {
    await mkdir(path.join(stage, '.vercel'), { recursive: true });
    await cp(path.join(root, '.vercel/output'), path.join(stage, '.vercel/output'), {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    await copyFile(
      path.join(root, '.vercel/project.json'),
      path.join(stage, '.vercel/project.json'),
    );
    // Native Next output can retain root-relative filePathMap entries. Keep the exact adapter
    // references at the paths Vercel's existing deploy collector consumes; never rewrite its maps.
    await copyMappedReferences(root, stage, files);
    const manifest = {
      sourceSha,
      sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
      platform: 'linux/x64',
      node: process.version,
      mappedFiles: files.references.length,
      nativeFiles: files.nativeFiles,
    };
    await writeFile(
      path.join(stage, 'release-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await collectArtifactFiles(stage, { credential });
    await checkProjectMetadata(stage, credential);
    execFileSync('tar', ['-czf', path.resolve(destination), '-C', stage, '.']);
    console.log(`Packaged ${files.references.length} mapped entries for ${sourceSha}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageArtifact(process.argv[2] ?? 'vercel-web-artifact.tar.gz');
}
