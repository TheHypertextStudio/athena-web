/** Private Google Cloud Storage adapter authenticated with Application Default Credentials. */
import { Storage } from '@google-cloud/storage';

import { GcsTransfer, type TransferObject } from './gcs-transfer';
import type { BlobPutResult, BlobStore } from './index';

/** Non-secret configuration for the private artifact bucket. */
export interface GcsBlobConfig {
  /** Bucket owned by the deployment's Google Cloud project. */
  readonly bucket: string;
  /** Validated application origin for browser resumable session CORS. */
  readonly uploadOrigin?: string;
}

/** Object operations used at the Google Cloud Storage provider boundary. */
export interface GcsObject extends TransferObject {
  /** Store bytes and metadata, replacing any existing object at this key. */
  save(
    data: Buffer,
    options: {
      readonly resumable: false;
      readonly metadata: { readonly contentType?: string; readonly cacheControl: string };
    },
  ): Promise<unknown>;
  /** Download all bytes; missing objects reject with provider code 404. */
  download(): Promise<[Uint8Array]>;
  /** Delete the object without failing when it is already absent. */
  delete(options: { readonly ignoreNotFound: true }): Promise<unknown>;
}

/** Bucket operations needed by the adapter, injectable at the external IO edge. */
export interface GcsBucket {
  /** Address one object without reading it. */
  file(key: string): GcsObject;
}

/** Identify missing-object failures without hiding authorization or provider outages. */
function missingObject(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 404;
}

/** Preserve the prior adapter's leading-slash normalization consistently across operations. */
function objectKey(key: string): string {
  return key.replace(/^\/+/, '');
}

/**
 * Private artifact storage using the Cloud Run runtime identity through ADC.
 *
 * Object addresses are durable storage locators, not anonymous browser download URLs. API routes
 * authorize downloads and serve bytes. No credentials or expiring signed URLs are persisted.
 */
export class GcsBlob implements BlobStore {
  private readonly bucket: GcsBucket;
  /** Direct resumable transfers, streamed reads and provider-side copies. */
  readonly transfer: GcsTransfer;

  /** @param config Non-secret bucket configuration. @param bucket Optional provider IO boundary. */
  constructor(
    private readonly config: GcsBlobConfig,
    bucket?: GcsBucket,
  ) {
    this.bucket = bucket ?? new Storage().bucket(config.bucket);
    this.transfer = new GcsTransfer(this.bucket, fetch, config.uploadOrigin);
  }

  /** {@inheritDoc BlobStore.put} */
  async put(key: string, data: Uint8Array, contentType?: string): Promise<BlobPutResult> {
    try {
      await this.bucket.file(objectKey(key)).save(Buffer.from(data), {
        resumable: false,
        metadata: {
          ...(contentType ? { contentType } : {}),
          cacheControl: 'private, no-store',
        },
      });
      return { key, url: this.url(key) };
    } catch (cause) {
      throw new Error(`GcsBlob put failed for key "${key}"`, { cause });
    }
  }

  /** {@inheritDoc BlobStore.get} */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const [bytes] = await this.bucket.file(objectKey(key)).download();
      return new Uint8Array(bytes);
    } catch (cause) {
      if (missingObject(cause)) return null;
      throw new Error(`GcsBlob get failed for key "${key}"`, { cause });
    }
  }

  /** {@inheritDoc BlobStore.url} */
  url(key: string): string {
    return `gs://${this.config.bucket}/${objectKey(key)}`;
  }

  /** {@inheritDoc BlobStore.delete} */
  async delete(key: string): Promise<void> {
    try {
      await this.bucket.file(objectKey(key)).delete({ ignoreNotFound: true });
    } catch (cause) {
      if (missingObject(cause)) return;
      throw new Error(`GcsBlob delete failed for key "${key}"`, { cause });
    }
  }
}
