import { GcsBlob, LocalDiskBlob, R2Blob } from '@docket/blob-store';
import type { BlobStore } from '@docket/blob-store';
import { isRealValue } from '@docket/env';

/** Runtime environment subset required to select and configure the blob store backend. */
export interface BlobStoreEnv {
  readonly APP_MODE?: string | undefined;
  readonly GCS_BLOB_BUCKET?: string | undefined;
  readonly R2_BLOB_BUCKET?: string | undefined;
  readonly R2_ACCOUNT_ID?: string | undefined;
  readonly R2_ACCESS_KEY_ID?: string | undefined;
  readonly R2_SECRET_ACCESS_KEY?: string | undefined;
  readonly WEB_URL?: string | undefined;
}

function requiredBlobConfig(name: string, value: string | undefined): string {
  if (!isRealValue(value)) throw new Error(`Missing required production config: ${name}`);
  return value;
}

/**
 * Construct the runtime blob store adapter, preferring Cloudflare R2 over GCS outside local/test mode.
 *
 * @param runtimeEnv - Runtime configuration values.
 * @returns the configured blob store adapter.
 */
export function buildBlobStore(runtimeEnv: BlobStoreEnv): BlobStore {
  if (runtimeEnv.APP_MODE === 'local' || runtimeEnv.APP_MODE === 'test') {
    return new LocalDiskBlob();
  }
  if (isRealValue(runtimeEnv.R2_BLOB_BUCKET)) {
    return new R2Blob({
      bucket: runtimeEnv.R2_BLOB_BUCKET,
      accountId: requiredBlobConfig('R2_ACCOUNT_ID', runtimeEnv.R2_ACCOUNT_ID),
      accessKeyId: requiredBlobConfig('R2_ACCESS_KEY_ID', runtimeEnv.R2_ACCESS_KEY_ID),
      secretAccessKey: requiredBlobConfig('R2_SECRET_ACCESS_KEY', runtimeEnv.R2_SECRET_ACCESS_KEY),
    });
  }
  return new GcsBlob({
    bucket: requiredBlobConfig('GCS_BLOB_BUCKET', runtimeEnv.GCS_BLOB_BUCKET),
    uploadOrigin: requiredBlobConfig('WEB_URL', runtimeEnv.WEB_URL),
  });
}
