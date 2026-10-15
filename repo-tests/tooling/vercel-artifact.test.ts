import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  cp,
  readlink,
  lstat,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectArtifactFiles, copyMappedReferences } from '../../scripts/package-vercel-artifact';

const cleanupPaths: string[] = [];
afterEach(async () => {
  for (const entry of cleanupPaths.splice(0)) await rm(entry, { recursive: true, force: true });
});

async function fixture(): Promise<{
  root: string;
  fn: string;
  config: (value: unknown) => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'docket-artifact-'));
  cleanupPaths.push(root);
  const fn = path.join(root, '.vercel/output/functions/page.func');
  await mkdir(fn, { recursive: true });
  return {
    root,
    fn,
    config: (value: unknown) => writeFile(path.join(fn, '.vc-config.json'), JSON.stringify(value)),
  };
}

test('includes mapped runtime dependencies and accepts Linux x64 binaries', async () => {
  const { root, config } = await fixture();
  await mkdir(path.join(root, 'node_modules/native'), { recursive: true });
  const elf = Buffer.alloc(64);
  elf.write('\x7fELF', 'binary');
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(62, 18);
  await writeFile(path.join(root, 'node_modules/native/image.node'), elf);
  await config({
    runtime: 'nodejs24.x',
    architecture: 'x86_64',
    filePathMap: { 'image.node': 'node_modules/native/image.node' },
  });
  const result = await collectArtifactFiles(root);
  assert.deepEqual(result.references, ['node_modules/native/image.node']);
  assert.equal(result.nativeFiles.length, 1);
});

test('rejects missing mapped files, secrets, and paths outside the release root', async () => {
  const { root, config } = await fixture();
  for (const reference of ['missing.js', '.npmrc', '../outside.js']) {
    await config({ filePathMap: { dependency: reference } });
    await assert.rejects(collectArtifactFiles(root));
  }
});

test('rejects Mac native binaries and incompatible function architecture', async () => {
  const { root, config } = await fixture();
  await writeFile(path.join(root, 'image.node'), Buffer.from('cffaedfe', 'hex'));
  await config({ architecture: 'x86_64', filePathMap: { 'image.node': 'image.node' } });
  await assert.rejects(collectArtifactFiles(root), /Linux x64 ELF/);
  await config({ architecture: 'arm64' });
  await assert.rejects(collectArtifactFiles(root), /architecture/);
});

test('rejects an output symlink that escapes the packaged output', async () => {
  const { root, fn, config } = await fixture();
  await writeFile(path.join(root, 'outside.js'), 'runtime');
  await symlink(path.join(root, 'outside.js'), path.join(fn, 'escape.js'));
  await config({});
  await assert.rejects(collectArtifactFiles(root), /symlink/);
});

test('rejects credentials accidentally included in function environment', async () => {
  const { root, config } = await fixture();
  await config({ environment: { NODE_AUTH_TOKEN: 'test-placeholder' } });
  await assert.rejects(collectArtifactFiles(root), /credential/);
});

test('rejects physical credential files in the native output', async () => {
  const { root, fn, config } = await fixture();
  await config({});
  await writeFile(path.join(fn, '.env.local'), 'INTERNAL_KEY=test-placeholder');
  await assert.rejects(collectArtifactFiles(root), /credential|Unsafe/);
});

test('preserves the public passkey relying-party configuration', async () => {
  const { root, config } = await fixture();
  await config({ environment: { BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'docket.hypertext.studio' } });
  const result = await collectArtifactFiles(root);
  assert.deepEqual(result.references, []);
});
test('rejects the job credential in both output and mapped file contents', async () => {
  const { root, fn, config } = await fixture();
  const credential = 'fixture-job-credential';
  await config({});
  const output = path.join(fn, 'launcher.js');
  await writeFile(output, `const leaked = '${credential}'`);
  await assert.rejects(collectArtifactFiles(root, { credential }), /credential/);
  await rm(output);
  await writeFile(path.join(root, 'mapped.js'), credential);
  await config({ filePathMap: { 'mapped.js': 'mapped.js' } });
  await assert.rejects(collectArtifactFiles(root, { credential }), /credential/);
});

test('audits native magic even without an extension', async () => {
  const { root, config } = await fixture();
  await config({ filePathMap: { tool: 'tool' } });
  const tool = path.join(root, 'tool');
  await writeFile(tool, Buffer.from('cffaedfe00000000', 'hex'));
  await assert.rejects(collectArtifactFiles(root), /Linux x64 ELF/);
  const elf = Buffer.alloc(64);
  elf.write('\x7fELF', 'binary');
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(183, 18);
  await writeFile(tool, elf);
  await assert.rejects(collectArtifactFiles(root), /Linux x64 ELF/);
  elf.writeUInt16LE(62, 18);
  const elf32 = Buffer.from(elf);
  elf32[4] = 1;
  const bigEndian = Buffer.from(elf);
  bigEndian[5] = 2;
  for (const invalid of [elf.subarray(0, 4), elf32, bigEndian]) {
    await writeFile(tool, invalid);
    await assert.rejects(collectArtifactFiles(root), /Linux x64 ELF/);
  }
  await writeFile(tool, elf);
  assert.equal((await collectArtifactFiles(root)).nativeFiles.length, 1);
});

test('diagnoses rejected mapped directory contents', async () => {
  const { root, config } = await fixture();
  await mkdir(path.join(root, 'mapped-directory'));
  await writeFile(path.join(root, 'mapped-directory/.env.private'), 'fixture');
  await config({ filePathMap: { dependency: 'mapped-directory' } });
  await assert.rejects(
    collectArtifactFiles(root),
    /"source":"mapped-directory","type":"directory","symlink":null,"canonicalWithinRoot":true/,
  );
});

test('diagnoses mapped symlinks outside the root without accepting their targets', async () => {
  const { root, config } = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'docket-outside-'));
  cleanupPaths.push(outside);
  await writeFile(path.join(outside, 'runtime.js'), 'fixture');
  await symlink(path.join(outside, 'runtime.js'), path.join(root, 'mapped.js'));
  await config({ filePathMap: { dependency: 'mapped.js' } });
  await assert.rejects(
    collectArtifactFiles(root),
    /"source":"mapped.js","type":"symlink".*"canonicalWithinRoot":false/,
  );
});

test('rejects credential filenames directly in native output', async () => {
  const { root, fn, config } = await fixture();
  await config({});
  await writeFile(path.join(fn, '.npmrc'), 'fixture-registry-config');
  await assert.rejects(collectArtifactFiles(root), /credential file/);
});

test('preserves native mapped directory symlinks and only copies traced target files', async () => {
  const { root, config } = await fixture();
  const packageDir = 'node_modules/.pnpm/env/node_modules/@next/env';
  const alias = 'node_modules/.pnpm/next/node_modules/@next/env';
  await mkdir(path.join(root, packageDir, 'dist'), { recursive: true });
  await mkdir(path.dirname(path.join(root, alias)), { recursive: true });
  await symlink('../../../env/node_modules/@next/env', path.join(root, alias));
  await writeFile(path.join(root, packageDir, 'dist/index.js'), 'export const runtime = true;', {
    mode: 0o755,
  });
  await writeFile(path.join(root, packageDir, 'untraced.txt'), 'not part of native trace');
  await config({ filePathMap: { env: alias, runtime: `${packageDir}/dist/index.js` } });
  const files = await collectArtifactFiles(root);
  const stage = await mkdtemp(path.join(tmpdir(), 'docket-stage-'));
  cleanupPaths.push(stage);
  await cp(path.join(root, '.vercel'), path.join(stage, '.vercel'), { recursive: true });
  await copyMappedReferences(root, stage, files);
  assert.equal(await readlink(path.join(stage, alias)), '../../../env/node_modules/@next/env');
  assert.equal((await stat(path.join(stage, packageDir, 'dist/index.js'))).mode & 0o777, 0o755);
  await assert.rejects(stat(path.join(stage, packageDir, 'untraced.txt')), /ENOENT/);
  assert.deepEqual((await collectArtifactFiles(stage)).references, files.references);
});

test('rejects unsafe mapped symlink targets and recursive target contents', async () => {
  const { root, config } = await fixture();
  await mkdir(path.join(root, 'safe'), { recursive: true });
  await writeFile(path.join(root, '.env.private'), 'private fixture');
  const alias = path.join(root, 'alias');
  for (const target of [root, '../outside-fixture', '.env.private', 'alias']) {
    await symlink(target, alias);
    await config({ filePathMap: { alias: 'alias' } });
    await assert.rejects(collectArtifactFiles(root), /mapped dependency|symlink|ELOOP|ENOENT/);
    await rm(alias);
  }
  await symlink('safe', alias);
  await writeFile(path.join(root, 'safe', 'untraced'), 'fixture-job-secret');
  await assert.rejects(
    collectArtifactFiles(root, { credential: 'fixture-job-secret' }),
    /credential/,
  );
  await rm(path.join(root, 'safe', 'untraced'));
  await symlink('../safe', path.join(root, 'safe', 'cycle'));
  await assert.rejects(collectArtifactFiles(root), /cycle/);
});

test('recursively audits mapped directory targets for credentials, native format, escapes and dangling links', async () => {
  const { root, config } = await fixture();
  await mkdir(path.join(root, 'runtime'), { recursive: true });
  await config({ filePathMap: { runtime: 'runtime' } });
  const child = path.join(root, 'runtime', 'child');
  await writeFile(child, Buffer.from('cffaedfe00000000', 'hex'));
  await assert.rejects(collectArtifactFiles(root), /Linux x64 ELF/);
  await rm(child);
  await writeFile(path.join(root, 'runtime', '.env.private'), 'fixture');
  await assert.rejects(collectArtifactFiles(root), /Unsafe mapped dependency/);
  await rm(path.join(root, 'runtime', '.env.private'));
  for (const target of ['missing', '../../outside']) {
    await symlink(target, child);
    await assert.rejects(collectArtifactFiles(root), /ENOENT|Escaping mapped/);
    await rm(child);
  }
});

test('requires mapped file symlink targets to be explicitly traced and rejects indirect cycles', async () => {
  const { root, config } = await fixture();
  await writeFile(path.join(root, 'target.js'), 'traced runtime');
  await symlink('target.js', path.join(root, 'alias.js'));
  await config({ filePathMap: { alias: 'alias.js' } });
  await assert.rejects(collectArtifactFiles(root), /Untraced mapped symlink file target/);
  await config({ filePathMap: { alias: 'alias.js', target: 'target.js' } });
  assert.equal((await collectArtifactFiles(root)).references.length, 2);
  await symlink('cycle-b', path.join(root, 'cycle-a'));
  await symlink('cycle-a', path.join(root, 'cycle-b'));
  await config({ filePathMap: { cycle: 'cycle-a' } });
  await assert.rejects(collectArtifactFiles(root), /ELOOP|cycle/);
});

test('preserves mapped symlinks already copied in native output and rejects conflicting entries', async () => {
  const { root, fn, config } = await fixture();
  const target = path.join(fn, 'runtime.js');
  const alias = path.join(fn, 'alias.js');
  await writeFile(target, 'native runtime', { mode: 0o755 });
  await symlink('runtime.js', alias);
  await config({
    filePathMap: { alias: path.relative(root, alias), target: path.relative(root, target) },
  });
  const files = await collectArtifactFiles(root);
  const stage = await mkdtemp(path.join(tmpdir(), 'docket-existing-output-'));
  cleanupPaths.push(stage);
  await cp(path.join(root, '.vercel'), path.join(stage, '.vercel'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await copyMappedReferences(root, stage, files);
  const stagedAlias = path.join(stage, path.relative(root, alias));
  assert.equal(await readlink(stagedAlias), 'runtime.js');
  assert.equal((await lstat(stagedAlias)).mode, (await lstat(alias)).mode);
  assert.equal((await stat(stagedAlias)).mode & 0o777, 0o755);
  await collectArtifactFiles(stage);
  await rm(stagedAlias);
  await symlink('other.js', stagedAlias);
  await assert.rejects(
    copyMappedReferences(root, stage, files),
    /Conflicting staged mapped symlink/,
  );
  await rm(stagedAlias);
  await writeFile(stagedAlias, 'conflicting regular file');
  await assert.rejects(
    copyMappedReferences(root, stage, files),
    /Conflicting staged mapped symlink/,
  );
});

test('rejects job credentials in native readlink bytes even when normalization removes them', async () => {
  const { root, fn, config } = await fixture();
  const credential = 'fixture-link-job-token';
  await mkdir(path.join(root, credential));
  await mkdir(path.join(root, 'safe'));
  await symlink(`${credential}/../safe`, path.join(root, 'alias'));
  await config({ filePathMap: { alias: 'alias' } });
  await assert.rejects(
    collectArtifactFiles(root, { credential }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('credential') &&
      !error.message.includes(credential),
  );
  await config({});
  await mkdir(path.join(fn, credential));
  await writeFile(path.join(fn, 'runtime.js'), 'native runtime');
  await symlink(`${credential}/../runtime.js`, path.join(fn, 'alias.js'));
  await assert.rejects(
    collectArtifactFiles(root, { credential }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('credential') &&
      !error.message.includes(credential),
  );
});
