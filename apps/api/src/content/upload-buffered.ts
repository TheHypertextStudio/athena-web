import { deferAfterResponse } from '../lib/after-response';
import { cleanUnpublishedUpload } from './upload-cleanup';
import { randomUUID } from 'node:crypto';
import { attachment, db } from '@docket/db';
import { Crc32c } from '@docket/blob-store/checksum';
import { and, eq } from 'drizzle-orm';
import { UploadBegin } from '../contracts/uploads';
import { getContainer } from '../container';
import { ConflictError } from '../error';
import { reserveUpload } from './upload-reservation';
import { uploadOwner } from './deliverable-model';
import { assertSharedWorkWritable } from '../product-capability';
import { authorizeResourceSubject } from './resource-subject';
import {
  assertPendingUpload,
  authorizeUpload,
  lockUpload,
  uploadCapability,
  type UploadRow,
} from './upload-model';
import { publishUpload } from './upload-completion';
import type { DraftOwner } from './deliverable-model';

/** Small legacy bodies adapt into the same reservation, integrity and publication transaction. */
export async function uploadBuffered(
  orgId: string,
  actorId: string,
  input: Omit<UploadBegin, 'crc32c' | 'byteSize' | 'requestId'> & {
    requestId?: string | undefined;
  },
  bytes: Uint8Array,
  owner?: DraftOwner,
): Promise<{ row: typeof attachment.$inferSelect; replayed: boolean }> {
  const crc = new Crc32c();
  crc.update(bytes);
  const declaration = UploadBegin.parse({
    ...input,
    requestId: input.requestId ?? randomUUID(),
    byteSize: bytes.length,
    crc32c: crc.digest(),
  });
  await assertSharedWorkWritable(orgId);
  if (declaration.destination.kind === 'work')
    await authorizeResourceSubject({ orgId, actorId, ...declaration.destination }, 'contribute');
  const id = await reserveUpload(orgId, actorId, declaration, owner ?? uploadOwner(actorId));
  return db
    .transaction(async (tx) => {
      let row: UploadRow = await lockUpload(tx, orgId, actorId, id, owner);
      const replayed = row.state === 'completed';
      if (!replayed) {
        assertPendingUpload(row);
        await authorizeUpload(row, tx);
        const capability = uploadCapability(row);
        await getContainer().blob.transfer.cancel(
          row.blobKey,
          capability?.kind === 'gcs' ? capability.uri : null,
        );
        await getContainer().blob.put(row.blobKey, bytes, row.mimeType);
      }
      row = await publishUpload(tx, row);
      const [file] = await tx
        .select()
        .from(attachment)
        .where(and(eq(attachment.id, row.attachmentId), eq(attachment.organizationId, orgId)))
        .limit(1);
      if (!file) throw new ConflictError();
      return { row: file, replayed };
    })
    .catch((error: unknown) => {
      if (declaration.destination.kind === 'work')
        deferAfterResponse('buffered-upload-cleanup', () => cleanUnpublishedUpload(id));
      throw error;
    });
}
