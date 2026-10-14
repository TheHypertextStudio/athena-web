import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectArtifactFiles } from '../../scripts/package-vercel-artifact';

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
