import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalDiskBlob } from '../../src/local-disk';

describe('LocalDiskBlob', () => {
  let root: string;
  let blob: LocalDiskBlob;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docket-blob-store-'));
    blob = new LocalDiskBlob({ root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes and reads bytes back for a nested key, creating parent directories', async () => {
    const data = new TextEncoder().encode('hello world');
    const result = await blob.put('nested/dir/a.txt', data);

    expect(result.key).toBe('nested/dir/a.txt');
    expect(result.url).toBe(blob.url('nested/dir/a.txt'));

    const got = await blob.get('nested/dir/a.txt');
    expect(got && new TextDecoder().decode(got)).toBe('hello world');
  });

  it('returns null from get for a missing key', async () => {
    expect(await blob.get('does/not/exist.txt')).toBeNull();
  });

  it('resolves a file:// url without touching disk', () => {
    const url = blob.url('a.txt');
    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('/a.txt')).toBe(true);
  });

  it('deletes an existing key', async () => {
    await blob.put('a.txt', new Uint8Array([1, 2, 3]));
    await blob.delete('a.txt');
    expect(await blob.get('a.txt')).toBeNull();
  });

  it('is a no-op deleting a key that does not exist', async () => {
    await expect(blob.delete('never-existed.txt')).resolves.toBeUndefined();
  });

  it('defaults the root to .data/exports when none is given', () => {
    const defaultBlob = new LocalDiskBlob();
    expect(defaultBlob.url('a.txt')).toContain('/.data/exports/a.txt');
  });

  it('rejects an absolute key', async () => {
    await expect(blob.put('/etc/passwd', new Uint8Array([1]))).rejects.toThrow(
      /LocalDiskBlob: unsafe key/,
    );
  });

  it('rejects a key that traverses above the root with ..', async () => {
    await expect(blob.put('../escape.txt', new Uint8Array([1]))).rejects.toThrow(
      /LocalDiskBlob: unsafe key/,
    );
  });

  it('rejects a key with an embedded .. traversal segment', async () => {
    await expect(blob.put('nested/../../escape.txt', new Uint8Array([1]))).rejects.toThrow(
      /LocalDiskBlob: unsafe key/,
    );
  });
});
