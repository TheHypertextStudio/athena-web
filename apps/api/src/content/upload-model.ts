import { createHash } from 'node:crypto';
import type { db } from '@docket/db';
import { fileUpload, type Database } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { TransferOptions } from '@docket/blob-store';
import { ConflictError, NotFoundError } from '../error';
import { assertSharedWorkWritable } from '../product-capability';
import { authorizeResourceSubject } from './resource-subject';
import { type DraftOwner, uploadOwner } from './deliverable-model';
import { openUploadCapability } from './upload-crypto';
import { WorkResourceSubjectType } from '@docket/work/attachment-contract';

/** Persisted upload receipt. */
export type UploadRow = typeof fileUpload.$inferSelect;
/** Transaction shared by session publication and attachment metadata. */
export type UploadTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Provider transport capability, kept encrypted at rest. */
export type UploadCapability = { kind: 'local'; token: string } | { kind: 'gcs'; uri: string };

/** Stable namespace includes every verified performer boundary. */
export function uploadOwnerKey(owner: DraftOwner): string {
  return createHash('sha256').update(JSON.stringify(owner)).digest('hex');
}
/** Load and lock one upload owned by the exact current client and performer. */
export async function lockUpload(
  tx: UploadTx,
  orgId: string,
  actorId: string,
  id: string,
  owner = uploadOwner(actorId),
): Promise<UploadRow> {
  const [row] = await tx
    .select()
    .from(fileUpload)
    .where(
      and(
        eq(fileUpload.id, id),
        eq(fileUpload.organizationId, orgId),
        eq(fileUpload.ownerKey, uploadOwnerKey(owner)),
      ),
    )
    .for('update');
  if (row?.actorId !== actorId || owner.actorId !== actorId) throw new NotFoundError();
  return row;
}
/** Recheck current contribution and entitlement at each publication boundary. */
export async function authorizeUpload(row: UploadRow, database: Database): Promise<void> {
  await assertSharedWorkWritable(row.organizationId, undefined, database);
  if (row.subjectType !== 'draft')
    await authorizeResourceSubject(
      {
        orgId: row.organizationId,
        actorId: row.actorId,
        subjectType: WorkResourceSubjectType.parse(row.subjectType),
        subjectId: row.subjectId ?? '',
      },
      'contribute',
      database,
    );
}
/** Reject inactive or retired sessions without exposing provider capabilities. */
export function assertPendingUpload(row: UploadRow): void {
  if (row.state !== 'pending' || row.expiresAt <= new Date()) throw new ConflictError();
}
/** Read the encrypted provider capability, bound to its session identity. */
export function uploadCapability(row: UploadRow): UploadCapability | null {
  if (!row.capability) return null;
  const value: unknown = JSON.parse(openUploadCapability(row.id, row.capability));
  if (typeof value !== 'object' || value === null) throw new Error('Invalid upload capability');
  if (
    'kind' in value &&
    value.kind === 'local' &&
    'token' in value &&
    typeof value.token === 'string'
  )
    return { kind: 'local', token: value.token };
  if ('kind' in value && value.kind === 'gcs' && 'uri' in value && typeof value.uri === 'string')
    return { kind: 'gcs', uri: value.uri };
  throw new Error('Invalid upload capability');
}
/** Storage declaration derived only from the immutable session row. */
export function uploadOptions(row: UploadRow): TransferOptions {
  return { byteSize: row.byteSize, crc32c: row.crc32c, contentType: row.mimeType };
}
