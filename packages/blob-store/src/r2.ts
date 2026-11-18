/** Private Cloudflare R2 storage adapter authenticated with S3 API credentials. */
import { Crc32c } from './checksum';
import { defaultHttpClient, type HttpClient } from './http';
import type { BlobPutResult, BlobStore } from './index';
import { normalizeR2Key, signR2Request, type R2Credentials } from './r2-signer';
import { R2Transfer } from './r2-transfer';

/** Configuration for {@link R2Blob}. */
export type R2BlobConfig = R2Credentials;

function computeCrc32c(data: Uint8Array): string {
  const crc = new Crc32c();
  crc.update(data);
  return crc.digest();
}

/**
 * Private artifact storage backed by Cloudflare R2 via signed S3 REST requests.
 *
 * Uses Web `fetch` and `node:crypto` without external SDK dependencies so the same adapter runs
 * cleanly in both Node 24 containers and Cloudflare Workers (`nodejs_compat`).
 */
export class R2Blob implements BlobStore {
  private readonly http: HttpClient;
  /** Bounded chunked transfers, streamed reads, and server-side copies. */
  readonly transfer: R2Transfer;

  /** @param config R2 account, bucket, and S3 credentials. @param http Optional fetch transport. */
  constructor(
    private readonly config: R2BlobConfig,
    http: HttpClient = defaultHttpClient,
  ) {
    this.http = http;
    this.transfer = new R2Transfer(config, http);
  }

  /** {@inheritDoc BlobStore.put} */
  async put(key: string, data: Uint8Array, contentType?: string): Promise<BlobPutResult> {
    const normalized = normalizeR2Key(key);
    const signed = signR2Request(this.config, {
      method: 'PUT',
      key: normalized,
      body: data,
      headers: {
        'Cache-Control': 'private, no-store',
        'x-amz-meta-crc32c': computeCrc32c(data),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
    });
    try {
      const res = await this.http(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: new Uint8Array(data),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { key, url: this.url(key) };
    } catch (cause) {
      throw new Error(`R2Blob put failed for key "${key}"`, { cause });
    }
  }

  /** {@inheritDoc BlobStore.get} */
  async get(key: string): Promise<Uint8Array | null> {
    const signed = signR2Request(this.config, { method: 'GET', key });
    try {
      const res = await this.http(signed.url, {
        method: signed.method,
        headers: signed.headers,
      });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch (cause) {
      throw new Error(`R2Blob get failed for key "${key}"`, { cause });
    }
  }

  /** {@inheritDoc BlobStore.url} */
  url(key: string): string {
    return `r2://${this.config.bucket}/${normalizeR2Key(key)}`;
  }

  /** {@inheritDoc BlobStore.delete} */
  async delete(key: string): Promise<void> {
    const signed = signR2Request(this.config, { method: 'DELETE', key });
    try {
      const res = await this.http(signed.url, {
        method: signed.method,
        headers: signed.headers,
      });
      await res.body?.cancel();
      if (res.status === 404 || res.ok) return;
      throw new Error(`HTTP ${res.status}`);
    } catch (cause) {
      throw new Error(`R2Blob delete failed for key "${key}"`, { cause });
    }
  }
}
