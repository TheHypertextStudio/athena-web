/**
 * `@docket/blob-store` - `RealBlob`.
 *
 * @remarks
 * The env-driven {@link BlobStore} that stores export artifacts + attachments in
 * Vercel Blob (`@vercel/blob`). Selected only when its `BLOB_READ_WRITE_TOKEN` is
 * present and real-shaped by the API container and never in
 * `APP_MODE ∈ {local,test}`. Values come from validated env.
 *
 * Writes go through the `@vercel/blob` SDK (`put`); reads are a plain authenticated
 * `GET` against the public blob URL through an injectable {@link HttpClient}. The
 * actual SDK upload and the network read are the I/O boundary (they can only be
 * exercised against the live Blob service), so those dispatch lines are v8-ignored —
 * like the DB driver — while the request/response mapping (option shaping, URL
 * construction, 404 to null, error wrapping) stays unit-covered.
 * No business logic lives here — only the storage edge.
 */
import { del as vercelBlobDel, put as vercelBlobPut, type PutBlobResult } from '@vercel/blob';

import type { BlobPutResult, BlobStore } from './index';
import { defaultHttpClient, type HttpClient } from './http';

/** Validated configuration for {@link RealBlob} (sourced from env). */
export interface RealBlobConfig {
  /**
   * Public base URL of the Vercel Blob store (`EXPORT_BUCKET_URL`), e.g.
   * `https://<store-id>.public.blob.vercel-storage.com`. Artifacts are addressed
   * as `${baseUrl}/${key}`.
   */
  readonly baseUrl: string;
  /** Vercel Blob read/write token (`BLOB_READ_WRITE_TOKEN`) used to authenticate uploads + reads. */
  readonly token: string;
}

/**
 * The `@vercel/blob` `put`-shaped upload function, narrowed to the arguments
 * {@link RealBlob} uses. Injectable so the option-shaping + result-mapping logic is
 * unit-testable without hitting the live Blob service.
 */
export type BlobUploadFn = (
  pathname: string,
  body: Uint8Array,
  options: {
    readonly access: 'public';
    readonly token: string;
    readonly contentType?: string;
    readonly addRandomSuffix: false;
    readonly allowOverwrite: true;
  },
) => Promise<PutBlobResult>;

/**
 * The `@vercel/blob` `del`-shaped delete function, narrowed to the arguments {@link RealBlob} uses.
 * Injectable so the delete dispatch is unit-testable without hitting the live Blob service.
 */
export type BlobDeleteFn = (url: string, options: { readonly token: string }) => Promise<void>;

/** Optional injectable seams for {@link RealBlob} (HTTP transport + SDK upload/delete fns). */
export interface RealBlobDeps {
  /** HTTP transport used by {@link RealBlob.get} (defaults to the platform `fetch`). */
  readonly http?: HttpClient;
  /** The Vercel Blob upload function (defaults to the real `@vercel/blob` `put`). */
  readonly upload?: BlobUploadFn;
  /** The Vercel Blob delete function (defaults to the real `@vercel/blob` `del`). */
  readonly delete?: BlobDeleteFn;
}

/** The SDK `put` body type, derived from the SDK signature (it is not re-exported by name). */
type VercelBlobPutBody = Parameters<typeof vercelBlobPut>[1];

/* v8 ignore start -- IO boundary default: binds the real `@vercel/blob` `put`, which
   can only run against the live Blob service. Unit tests inject {@link RealBlobDeps.upload}.
   The `Uint8Array` body is a valid runtime body; the SDK's union just omits it, so the
   single cast at this boundary line bridges that gap (not an `any`). */
const defaultUpload: BlobUploadFn = (pathname, body, options) =>
  vercelBlobPut(pathname, body as unknown as VercelBlobPutBody, options);
/* v8 ignore stop */

/* v8 ignore start -- IO boundary default: binds the real `@vercel/blob` `del`, which can only run
   against the live Blob service. Unit tests inject {@link RealBlobDeps.delete}. */
const defaultDelete: BlobDeleteFn = (url, options) => vercelBlobDel(url, options);
/* v8 ignore stop */

/** Strip leading slashes so a key joins cleanly onto the store base URL. */
function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '');
}

/**
 * A real, env-driven blob store backed by Vercel Blob.
 *
 * @remarks
 * `put` uploads via the `@vercel/blob` SDK with a deterministic pathname (no random
 * suffix, overwrite allowed) so a key maps 1:1 to a stored object; `get` reads the
 * bytes from the public URL (returning `null` on 404); `url` addresses a key without
 * any I/O.
 */
export class RealBlob implements BlobStore {
  private readonly token: string;
  private readonly base: string;
  private readonly http: HttpClient;
  private readonly upload: BlobUploadFn;
  private readonly del: BlobDeleteFn;

  /**
   * @param config - Validated base URL + token from env.
   * @param deps - Optional HTTP transport / SDK upload fn (the second positional
   *   arg may also be a bare {@link HttpClient} for parity with the other real
   *   adapters' `(config, http)` shape).
   */
  constructor(config: RealBlobConfig, deps: RealBlobDeps | HttpClient = {}) {
    this.token = config.token;
    this.base = config.baseUrl.replace(/\/+$/, '');
    const resolved: RealBlobDeps = typeof deps === 'function' ? { http: deps } : deps;
    this.http = resolved.http ?? defaultHttpClient;
    this.upload = resolved.upload ?? defaultUpload;
    this.del = resolved.delete ?? defaultDelete;
  }

  /** {@inheritDoc BlobStore.put} */
  async put(key: string, data: Uint8Array, contentType?: string): Promise<BlobPutResult> {
    const pathname = normalizeKey(key);
    let result: PutBlobResult;
    try {
      result = await this.upload(pathname, data, {
        access: 'public',
        token: this.token,
        ...(contentType ? { contentType } : {}),
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    } catch (cause) {
      throw new Error(`RealBlob put failed for key "${key}"`, { cause });
    }
    // With `addRandomSuffix: false` the stored pathname equals our key, so the
    // SDK-returned `url` is the authoritative address; fall back to a constructed
    // URL if a future SDK omits it.
    return { key, url: result.url || this.url(key) };
  }

  /** {@inheritDoc BlobStore.get} */
  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.http(this.url(key), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RealBlob get failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** {@inheritDoc BlobStore.url} */
  url(key: string): string {
    return `${this.base}/${normalizeKey(key)}`;
  }

  /** {@inheritDoc BlobStore.delete} */
  async delete(key: string): Promise<void> {
    try {
      await this.del(this.url(key), { token: this.token });
    } catch (cause) {
      throw new Error(`RealBlob delete failed for key "${key}"`, { cause });
    }
  }
}
