import { createReadStream } from 'node:fs';
import { constants, copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { Crc32c } from './checksum';
import type {
  BlobMetadata,
  BlobRange,
  BlobTransfer,
  TransferOptions,
  TransferProgress,
} from './transfer';

async function size(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
}
async function metadata(path: string): Promise<BlobMetadata | null> {
  const byteSize = await size(path);
  if (byteSize === null) return null;
  const checksum = new Crc32c();
  for await (const chunk of createReadStream(path)) checksum.update(chunk as Uint8Array);
  return { byteSize, crc32c: checksum.digest(), generation: (await stat(path)).ino.toString() };
}

/** Local provider implementing durable resumable chunks; callers serialize a key with its DB row. */
export class LocalTransfer implements BlobTransfer {
  /** @param pathFor Resolves a validated opaque storage key inside the adapter root. */
  constructor(private readonly pathFor: (key: string) => string) {}

  /** {@inheritDoc BlobTransfer.begin} */
  async begin(key: string, _options: TransferOptions): Promise<null> {
    const path = this.pathFor(`${key}.partial`);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, 'a');
    await file.close();
    return null;
  }

  /** {@inheritDoc BlobTransfer.status} */
  async status(
    key: string,
    _options: TransferOptions,
    _uri: string | null,
  ): Promise<TransferProgress> {
    const complete = await size(this.pathFor(key));
    return complete === null
      ? { offset: (await size(this.pathFor(`${key}.partial`))) ?? 0, complete: false }
      : { offset: complete, complete: true };
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
    const path = this.pathFor(`${key}.partial`);
    const file = await open(path, 'r+');
    try {
      let written = 0;
      while (written < bytes.length)
        written += (await file.write(bytes, written, bytes.length - written, offset + written))
          .bytesWritten;
      await file.sync();
    } finally {
      await file.close();
    }
    if (offset + bytes.length === options.byteSize) await this.publish(key, options);
    return this.status(key, options, null);
  }

  private async publish(key: string, options: TransferOptions): Promise<void> {
    const path = this.pathFor(`${key}.partial`);
    const actual = await metadata(path);
    if (actual?.crc32c !== options.crc32c || actual.byteSize !== options.byteSize) {
      await rm(path, { force: true });
      await this.begin(key, options);
      throw new Error('Upload integrity mismatch');
    }
    await rename(path, this.pathFor(key));
  }

  /** {@inheritDoc BlobTransfer.cancel} */
  async cancel(key: string, _uri: string | null): Promise<void> {
    await rm(this.pathFor(`${key}.partial`), { force: true });
  }

  /** {@inheritDoc BlobTransfer.stat} */
  async stat(key: string): Promise<BlobMetadata | null> {
    return metadata(this.pathFor(key));
  }

  /** {@inheritDoc BlobTransfer.stream} */
  async stream(key: string, range?: BlobRange): Promise<ReadableStream<Uint8Array>> {
    return Readable.toWeb(createReadStream(this.pathFor(key), range)) as ReadableStream<Uint8Array>;
  }

  /** {@inheritDoc BlobTransfer.copy} */
  async copy(source: string, destination: string, _contentType: string): Promise<void> {
    const path = this.pathFor(destination);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(this.pathFor(source), path, constants.COPYFILE_EXCL);
  }
}
