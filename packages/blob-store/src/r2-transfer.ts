/** Cloudflare R2 resumable chunk transfer, stat, streaming reads, and server-side copies. */
import { Crc32c } from './checksum';
import { defaultHttpClient, type HttpClient } from './http';
import { encodeR2Path, signR2Request, type R2Credentials, type R2SignInput } from './r2-signer';
import type {
  BlobMetadata,
  BlobRange,
  BlobTransfer,
  TransferOptions,
  TransferProgress,
} from './transfer';

function partialKey(key: string): string {
  return `${key}.partial`;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

function crc32cBase64(bytes: Uint8Array): string {
  const checksum = new Crc32c();
  checksum.update(bytes);
  return checksum.digest();
}

function parseBlobMetadata(headers: Headers): BlobMetadata {
  const byteSize = Number(headers.get('content-length'));
  const crc32c = headers.get('x-amz-meta-crc32c') ?? '';
  const generation = headers.get('etag')?.replace(/^"+|"+$/g, '') ?? '';
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || !crc32c || !generation) {
    throw new Error('Invalid object metadata');
  }
  return { byteSize, crc32c, generation };
}

/**
 * Bounded resumable transfer and streaming boundary backed by Cloudflare R2.
 *
 * `begin` returns `null`, selecting Docket's authenticated chunked capability endpoint so R2
 * credentials never leave the server and single-chunk uploads publish in one R2 `PUT`.
 */
export class R2Transfer implements BlobTransfer {
  /** @param credentials R2 bucket coordinates and keys. @param http Injectable fetch edge. */
  constructor(
    private readonly credentials: R2Credentials,
    private readonly http: HttpClient = defaultHttpClient,
  ) {}

  private async send(input: R2SignInput): Promise<Response> {
    const signed = signR2Request(this.credentials, input);
    return this.http(signed.url, {
      method: signed.method,
      headers: signed.headers,
      ...(signed.body ? { body: new Uint8Array(signed.body) } : {}),
    });
  }

  private async putObject(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    crc32c: string,
  ): Promise<void> {
    const res = await this.send({
      method: 'PUT',
      key,
      body: bytes,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'x-amz-meta-crc32c': crc32c,
      },
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`R2Transfer put failed: ${res.status}`);
  }

  private async readObject(key: string): Promise<Uint8Array> {
    const res = await this.send({ method: 'GET', key });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`R2Transfer read failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  private async deleteIfPresent(key: string): Promise<void> {
    const res = await this.send({ method: 'DELETE', key });
    await res.body?.cancel();
    if (res.status !== 404 && !res.ok) {
      throw new Error(`R2Transfer delete failed: ${res.status}`);
    }
  }

  /** {@inheritDoc BlobTransfer.begin} */
  async begin(_key: string, _options: TransferOptions): Promise<null> {
    return null;
  }

  /** {@inheritDoc BlobTransfer.status} */
  async status(
    key: string,
    _options: TransferOptions,
    _uri: string | null,
  ): Promise<TransferProgress> {
    const complete = await this.stat(key);
    if (complete !== null) return { offset: complete.byteSize, complete: true };
    const partial = await this.stat(partialKey(key));
    return { offset: partial?.byteSize ?? 0, complete: false };
  }

  /** {@inheritDoc BlobTransfer.append} */
  async append(
    key: string,
    options: TransferOptions,
    offset: number,
    bytes: Uint8Array,
  ): Promise<TransferProgress> {
    const current = await this.status(key, options, null);
    if (
      current.complete ||
      offset !== current.offset ||
      bytes.length === 0 ||
      offset + bytes.length > options.byteSize
    ) {
      throw new Error('Invalid resumable chunk');
    }

    if (offset === 0 && bytes.length === options.byteSize) {
      return this.publishSingleChunk(key, options, bytes);
    }
    return this.appendMultiChunk(key, options, offset, bytes);
  }

  private async publishSingleChunk(
    key: string,
    options: TransferOptions,
    bytes: Uint8Array,
  ): Promise<TransferProgress> {
    if (crc32cBase64(bytes) !== options.crc32c) {
      throw new Error('Upload integrity mismatch');
    }
    await this.putObject(key, bytes, options.contentType, options.crc32c);
    return { offset: options.byteSize, complete: true };
  }

  private async appendMultiChunk(
    key: string,
    options: TransferOptions,
    offset: number,
    bytes: Uint8Array,
  ): Promise<TransferProgress> {
    const combined =
      offset > 0 ? concatBytes(await this.readObject(partialKey(key)), bytes) : bytes;
    const digest = crc32cBase64(combined);

    if (combined.length < options.byteSize) {
      await this.putObject(partialKey(key), combined, options.contentType, digest);
      return { offset: combined.length, complete: false };
    }

    if (digest !== options.crc32c) {
      await this.deleteIfPresent(partialKey(key));
      throw new Error('Upload integrity mismatch');
    }

    await this.putObject(key, combined, options.contentType, options.crc32c);
    await this.deleteIfPresent(partialKey(key));
    return { offset: options.byteSize, complete: true };
  }

  /** {@inheritDoc BlobTransfer.cancel} */
  async cancel(key: string, _uri: string | null): Promise<void> {
    await this.deleteIfPresent(partialKey(key));
  }

  /** {@inheritDoc BlobTransfer.stat} */
  async stat(key: string): Promise<BlobMetadata | null> {
    const res = await this.send({ method: 'HEAD', key });
    await res.body?.cancel();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2Transfer stat failed: ${res.status}`);
    return parseBlobMetadata(res.headers);
  }

  /** {@inheritDoc BlobTransfer.stream} */
  async stream(key: string, range?: BlobRange): Promise<ReadableStream<Uint8Array>> {
    const res = await this.send({
      method: 'GET',
      key,
      ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(`R2Transfer stream failed: ${res.status}`);
    }
    return res.body;
  }

  /** {@inheritDoc BlobTransfer.copy} */
  async copy(source: string, destination: string, contentType: string): Promise<void> {
    const res = await this.send({
      method: 'PUT',
      key: destination,
      headers: {
        'x-amz-copy-source': encodeR2Path(this.credentials.bucket, source),
        'x-amz-metadata-directive': 'COPY',
        'If-None-Match': '*',
        'Content-Type': contentType,
      },
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`R2Transfer copy failed: ${res.status}`);
  }
}
