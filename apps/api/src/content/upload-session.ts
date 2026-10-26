import { randomBytes } from 'node:crypto';
import { db, fileUpload } from '@docket/db';
import { eq } from 'drizzle-orm';
import { UPLOAD_CHUNK_BYTES } from '@docket/work/attachment-contract';
import { UploadBegin, UploadSessionOut } from '../contracts/uploads';
import { getContainer } from '../container';
import { env } from '../env';
import { ConflictError } from '../error';
import { assertSharedWorkWritable } from '../product-capability';
import { authorizeResourceSubject } from './resource-subject';
import { uploadOwner, type DraftOwner } from './deliverable-model';
import { reserveUpload } from './upload-reservation';
import { acceptedUploadFile, publishUpload } from './upload-completion';
import {
  assertPendingUpload,
  authorizeUpload,
  lockUpload,
  uploadCapability,
  uploadOptions,
  type UploadRow,
  type UploadTx,
} from './upload-model';
import { sealUploadCapability } from './upload-crypto';

/** Begin or recover the same immutable file upload for the current verified performer. */
export async function beginUpload(
  orgId: string,
  actorId: string,
  raw: UploadBegin,
  owner: DraftOwner = uploadOwner(actorId),
): Promise<UploadSessionOut> {
  const input = UploadBegin.parse(raw);
  await assertSharedWorkWritable(orgId);
  if (input.destination.kind === 'work')
    await authorizeResourceSubject({ orgId, actorId, ...input.destination }, 'contribute');
  const id = await reserveUpload(orgId, actorId, input, owner);
  return db.transaction(async (tx) => {
    let row = await lockUpload(tx, orgId, actorId, id, owner);
    await authorizeUpload(row, tx);
    if (row.state === 'pending') {
      assertPendingUpload(row);
      if (!row.capability) row = await initializeTransfer(tx, row);
    }
    return uploadOutput(tx, row);
  });
}

async function initializeTransfer(tx: UploadTx, row: UploadRow): Promise<UploadRow> {
  const uri = await getContainer().blob.transfer.begin(row.blobKey, uploadOptions(row));
  const capability = sealUploadCapability(
    row.id,
    JSON.stringify(
      uri ? { kind: 'gcs', uri } : { kind: 'local', token: randomBytes(32).toString('base64url') },
    ),
  );
  const [updated] = await tx
    .update(fileUpload)
    .set({ capability })
    .where(eq(fileUpload.id, row.id))
    .returning();
  if (!updated) throw new Error('Upload initialization did not persist');
  return updated;
}

/** Probe the acknowledged provider position using current authenticated ownership. */
export async function readUpload(
  orgId: string,
  actorId: string,
  id: string,
): Promise<UploadSessionOut> {
  return db.transaction(async (tx) => {
    const row = await lockUpload(tx, orgId, actorId, id);
    await authorizeUpload(row, tx);
    if (row.state === 'pending') assertPendingUpload(row);
    return uploadOutput(tx, row);
  });
}

/** Publish one work resource or private draft after exact provider integrity checks. */
export async function completeUpload(
  orgId: string,
  actorId: string,
  id: string,
): Promise<UploadSessionOut> {
  return db.transaction(async (tx) => {
    const row = await lockUpload(tx, orgId, actorId, id);
    return uploadOutput(tx, await publishUpload(tx, row));
  });
}

/** Project only accepted metadata and the active write capability; never expose a storage key. */
export async function uploadOutput(tx: UploadTx, row: UploadRow): Promise<UploadSessionOut> {
  const base = {
    id: row.id,
    state: row.state,
    byteSize: row.byteSize,
    chunkSize: UPLOAD_CHUNK_BYTES,
    expiresAt: row.expiresAt.toISOString(),
  };
  if (row.state === 'completed')
    return UploadSessionOut.parse({
      ...base,
      offset: row.byteSize,
      file: await acceptedUploadFile(tx, row),
    });
  if (row.state !== 'pending') return UploadSessionOut.parse({ ...base, offset: 0 });
  assertPendingUpload(row);
  const capability = uploadCapability(row);
  if (!capability) throw new ConflictError();
  const uri = capability.kind === 'gcs' ? capability.uri : null;
  const progress = await getContainer().blob.transfer.status(row.blobKey, uploadOptions(row), uri);
  return UploadSessionOut.parse({
    ...base,
    offset: progress.offset,
    uploadUrl: uri ?? `${env.API_URL}/v1/file-uploads/${row.id}/bytes`,
    ...(capability.kind === 'local' ? { uploadToken: capability.token } : {}),
  });
}
