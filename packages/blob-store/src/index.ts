/**
 * `@docket/blob-store` - the `BlobStore` port.
 *
 * @remarks
 * The single typed edge for binary artifact storage (export artifacts). The real
 * adapter targets Vercel Blob / S3 with env creds; the mock `LocalDiskBlob` writes
 * under `.data/exports`. No business logic lives here; only the storage edge does.
 */

/** Result of storing a blob. */
export interface BlobPutResult {
  /** The key the blob was stored under. */
  readonly key: string;
  /** A URL the blob can be fetched from. */
  readonly url: string;
}

/**
 * The blob storage port: a single typed edge for putting, getting, and addressing
 * binary artifacts by key. Implemented by `RealBlob` and `LocalDiskBlob`.
 */
export interface BlobStore {
  /**
   * Store bytes under a key.
   *
   * @param key - The storage key (path-like).
   * @param data - The bytes to store.
   * @param contentType - Optional MIME type to record.
   * @returns the stored key and a fetchable URL.
   */
  put(key: string, data: Uint8Array, contentType?: string): Promise<BlobPutResult>;

  /**
   * Read the bytes stored under a key.
   *
   * @param key - The storage key.
   * @returns the bytes, or `null` when no blob exists for the key.
   */
  get(key: string): Promise<Uint8Array | null>;

  /**
   * Resolve the fetchable URL for a key (without reading the bytes).
   *
   * @param key - The storage key.
   * @returns the URL the blob is addressable at.
   */
  url(key: string): string;

  /**
   * Delete the blob stored under a key. Idempotent — a no-op when no blob exists.
   *
   * @param key - The storage key to remove.
   */
  delete(key: string): Promise<void>;
}

export { LocalDiskBlob } from './local-disk';
export type { LocalDiskBlobOptions } from './local-disk';
export { RealBlob } from './vercel';
export type { BlobDeleteFn, BlobUploadFn, RealBlobConfig, RealBlobDeps } from './vercel';
