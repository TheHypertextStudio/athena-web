/**
 * `@docket/blob-store` - `LocalDiskBlob`.
 *
 * @remarks
 * An offline {@link BlobStore} that persists artifacts to the local filesystem under
 * a root directory (defaulting to `.data/exports`), addressing them with `file://`
 * URLs. Keys are sanitized to stay inside the root. Used for local dev + tests so
 * export artifacts work with zero blob credentials.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BlobPutResult, BlobStore } from './index';

/** Construction options for {@link LocalDiskBlob}. */
export interface LocalDiskBlobOptions {
  /** Root directory artifacts are written under (default `.data/exports`). */
  readonly root?: string;
}

/** Reject absolute keys and `..` traversal, returning a key safe to join to a root. */
function safeKey(key: string): string {
  if (isAbsolute(key)) {
    throw new Error(`LocalDiskBlob: unsafe key "${key}"`);
  }
  const cleaned = normalize(key);
  if (
    isAbsolute(cleaned) ||
    cleaned === '..' ||
    cleaned.startsWith(`..${sep}`) ||
    cleaned.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`LocalDiskBlob: unsafe key "${key}"`);
  }
  return cleaned;
}

/**
 * A filesystem-backed blob store for local/test runs.
 *
 * @remarks
 * `put` creates parent directories as needed; `get` returns `null` for a missing
 * key; `url` resolves a `file://` URL without touching the disk; `delete` removes the
 * file and is a no-op for a missing key.
 */
export class LocalDiskBlob implements BlobStore {
  private readonly root: string;

  /**
   * @param options - Optional root directory for stored artifacts.
   */
  constructor(options: LocalDiskBlobOptions = {}) {
    this.root = resolve(options.root ?? join('.data', 'exports'));
  }

  private pathFor(key: string): string {
    return join(this.root, safeKey(key).split('/').join(sep));
  }

  /** {@inheritDoc BlobStore.put} */
  async put(key: string, data: Uint8Array, _contentType?: string): Promise<BlobPutResult> {
    const filePath = this.pathFor(key);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, data);
    return { key, url: this.url(key) };
  }

  /** {@inheritDoc BlobStore.get} */
  async get(key: string): Promise<Uint8Array | null> {
    const filePath = this.pathFor(key);
    if (!existsSync(filePath)) return null;
    return new Uint8Array(readFileSync(filePath));
  }

  /** {@inheritDoc BlobStore.url} */
  url(key: string): string {
    return pathToFileURL(this.pathFor(key)).href;
  }

  /** {@inheritDoc BlobStore.delete} */
  async delete(key: string): Promise<void> {
    rmSync(this.pathFor(key), { force: true });
  }
}
