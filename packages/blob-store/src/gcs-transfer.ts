import { Readable } from 'node:stream';
import type { File } from '@google-cloud/storage';
import type {
  BlobMetadata,
  BlobRange,
  BlobTransfer,
  TransferOptions,
  TransferProgress,
} from './transfer';

/** Minimal provider boundary for resumable and bounded object IO. */
export interface TransferObject {
  /** Reserve an immutable object upload using the installed provider SDK contract. */
  createResumableUpload: File['createResumableUpload'];
  /** Read provider-owned size/checksum/generation. */
  getMetadata: File['getMetadata'];
  /** Open a Node stream, optionally ranged. */
  createReadStream: File['createReadStream'];
  /** Copy within the storage service. */
  copy: File['copy'];
}
/** Injectable object locator, independent of credentials. */
export interface TransferBucket {
  file(key: string): TransferObject;
}

/** Google JSON API resumable capabilities, never proxied through the application. */
export class GcsTransfer implements BlobTransfer {
  /** @param bucket ADC-authenticated provider boundary. @param request Capability-only protocol IO. */
  constructor(
    private readonly bucket: TransferBucket,
    private readonly request: typeof fetch = fetch,
    private readonly origin?: string,
  ) {}

  /** {@inheritDoc BlobTransfer.begin} */
  async begin(key: string, options: TransferOptions): Promise<string> {
    const [uri] = await this.bucket.file(key).createResumableUpload({
      preconditionOpts: { ifGenerationMatch: 0 },
      ...(this.origin ? { origin: new URL(this.origin).origin } : {}),
      metadata: {
        contentLength: options.byteSize,
        contentType: options.contentType,
        crc32c: options.crc32c,
        cacheControl: 'private, no-store',
      },
    });
    return uri;
  }

  /** {@inheritDoc BlobTransfer.status} */
  async status(
    _key: string,
    options: TransferOptions,
    uri: string | null,
  ): Promise<TransferProgress> {
    if (!uri) throw new Error('Missing upload capability');
    const response = await this.request(uri, {
      method: 'PUT',
      redirect: 'manual',
      headers: { 'Content-Length': '0', 'Content-Range': `bytes */${options.byteSize}` },
    });
    await response.body?.cancel();
    if (response.status === 200 || response.status === 201)
      return { offset: options.byteSize, complete: true };
    if (response.status !== 308) throw new Error('Upload status unavailable');
    const range = response.headers.get('Range');
    const match = range?.match(/^bytes=0-(\d+)$/u);
    if (range !== null && !match) throw new Error('Invalid upload acknowledgement');
    const offset = match ? Number(match[1]) + 1 : 0;
    if (offset > options.byteSize) throw new Error('Invalid upload acknowledgement');
    return { offset, complete: false };
  }

  /** {@inheritDoc BlobTransfer.cancel} */
  async cancel(_key: string, uri: string | null): Promise<void> {
    if (!uri) return;
    const response = await this.request(uri, { method: 'DELETE', redirect: 'manual' });
    await response.body?.cancel();
    if (![200, 204, 404, 410, 499].includes(response.status))
      throw new Error('Upload cancellation unavailable');
  }

  /** {@inheritDoc BlobTransfer.stat} */
  async stat(key: string): Promise<BlobMetadata | null> {
    try {
      const [metadata] = await this.bucket.file(key).getMetadata();
      const byteSize = Number(metadata.size);
      if (
        !Number.isSafeInteger(byteSize) ||
        byteSize < 0 ||
        !metadata.crc32c ||
        !metadata.generation
      )
        throw new Error('Invalid object metadata');
      return { byteSize, crc32c: metadata.crc32c, generation: String(metadata.generation) };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 404)
        return null;
      throw error;
    }
  }

  /** {@inheritDoc BlobTransfer.stream} */
  async stream(key: string, range?: BlobRange): Promise<ReadableStream<Uint8Array>> {
    return Readable.toWeb(
      this.bucket.file(key).createReadStream(range ?? {}),
    ) as ReadableStream<Uint8Array>;
  }

  /** {@inheritDoc BlobTransfer.copy} */
  async copy(source: string, destination: string, contentType: string): Promise<void> {
    await this.bucket.file(source).copy(this.bucket.file(destination) as File, {
      preconditionOpts: { ifGenerationMatch: 0 },
      contentType,
      cacheControl: 'private, no-store',
      metadata: {},
    });
  }
}
