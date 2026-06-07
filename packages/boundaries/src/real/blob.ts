/**
 * `@docket/boundaries/real` — `RealBlob`.
 *
 * @remarks
 * The env-driven {@link BlobStore} that stores artifacts in a token-authenticated
 * object store (Vercel Blob / S3-compatible). Selected only when its token is present
 * and real-shaped (see {@link selectAdapter}) and never in `APP_MODE ∈ {local,test}`.
 * Values come from validated env; the network edge goes through an injectable
 * {@link HttpClient}. No business logic lives here — only the storage edge
 * (`boundaries.md` §8).
 */
import type { BlobPutResult, BlobStore } from '../ports/blob';
import { defaultHttpClient, type HttpClient } from './http';

/** Validated configuration for {@link RealBlob} (sourced from env). */
export interface RealBlobConfig {
  /** Base URL of the object store (artifacts addressed as `${baseUrl}/${key}`). */
  readonly baseUrl: string;
  /** Read/write token used to authenticate requests. */
  readonly token: string;
}

/**
 * A real, env-driven blob store backed by a token-authenticated HTTP object store.
 *
 * @remarks
 * `put` PUTs the bytes, `get` GETs them (returning `null` on 404), and `url`
 * addresses a key without I/O.
 */
export class RealBlob implements BlobStore {
  private readonly config: RealBlobConfig;
  private readonly http: HttpClient;
  private readonly base: string;

  /**
   * @param config - Validated base URL + token from env.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: RealBlobConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
    this.base = config.baseUrl.replace(/\/+$/, '');
  }

  /** {@inheritDoc BlobStore.put} */
  async put(key: string, data: Uint8Array, contentType?: string): Promise<BlobPutResult> {
    const res = await this.http(this.url(key), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': contentType ?? 'application/octet-stream',
      },
      body: data,
    });
    if (!res.ok) throw new Error(`RealBlob put failed: ${res.status}`);
    return { key, url: this.url(key) };
  }

  /** {@inheritDoc BlobStore.get} */
  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.http(this.url(key), {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RealBlob get failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** {@inheritDoc BlobStore.url} */
  url(key: string): string {
    return `${this.base}/${key.replace(/^\/+/, '')}`;
  }
}
