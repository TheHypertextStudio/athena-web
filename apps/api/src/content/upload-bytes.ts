import { timingSafeEqual } from 'node:crypto';
import { db, fileUpload } from '@docket/db';
import { eq } from 'drizzle-orm';
import { UPLOAD_CHUNK_BYTES } from '@docket/work/attachment-contract';
import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { assertPendingUpload, uploadCapability, uploadOptions } from './upload-model';
import type { TransferProgress } from '@docket/blob-store';

/** Scoped local storage protocol; production sends bytes directly to the provider URI. */
export async function transferUploadBytes(
  id: string,
  token: string,
  range: string,
  bytes: Uint8Array,
): Promise<TransferProgress> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(fileUpload).where(eq(fileUpload.id, id)).for('update');
    if (row?.state !== 'pending' || row.expiresAt <= new Date()) throw new NotFoundError();
    const capability = uploadCapability(row);
    if (capability?.kind !== 'local' || !sameToken(token, capability.token))
      throw new NotFoundError();
    assertPendingUpload(row);
    const transfer = getContainer().blob.transfer;
    const options = uploadOptions(row);
    if (range === `bytes */${row.byteSize}` && bytes.length === 0)
      return transfer.status(row.blobKey, options, null);
    const offset = chunkOffset(range, row.byteSize, bytes.length);
    if (!transfer.append) throw new ConflictError();
    try {
      return await transfer.append(row.blobKey, options, offset, bytes);
    } catch {
      throw new ConflictError();
    }
  });
}
function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function chunkOffset(range: string, byteSize: number, length: number): number {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(range);
  if (
    !match ||
    Number(match[3]) !== byteSize ||
    Number(match[2]) - Number(match[1]) + 1 !== length ||
    length > UPLOAD_CHUNK_BYTES
  )
    throw new ConflictError();
  return Number(match[1]);
}
