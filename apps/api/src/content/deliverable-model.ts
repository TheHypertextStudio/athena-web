import { attachment } from '@docket/db';
import { DeliverableOut } from '@docket/work/attachment-contract';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { currentProvenance } from '../lib/provenance/context';

/** Persisted file metadata used by the draft and post lifecycle. */
export type AttachmentRow = typeof attachment.$inferSelect;

/** Verified identity fields that own an unattached upload. */
export interface DraftOwner {
  readonly actorId: string;
  readonly performerKind: string;
  readonly performerId: string | null;
  readonly clientId: string | null;
}

/** Pending uploads are owned by both the authorizing actor and the verified performer/client. */
export function uploadOwner(actorId: string): DraftOwner {
  const origin = currentProvenance();
  if (
    !origin ||
    (origin.performer.kind !== 'person' && !origin.performer.actorId && !origin.clientId)
  )
    throw new NotFoundError();
  return {
    actorId,
    performerKind: origin.performer.kind,
    performerId: origin.performer.actorId ?? null,
    clientId: origin.clientId ?? null,
  };
}

/** Match all verified identity fields so another client or performer cannot recover this draft. */
export function draftOwnerWhere(owner: DraftOwner): SQL | undefined {
  return and(
    eq(attachment.draftOwnerActorId, owner.actorId),
    eq(attachment.draftOwnerPerformerKind, owner.performerKind),
    owner.performerId === null
      ? isNull(attachment.draftOwnerPerformerId)
      : eq(attachment.draftOwnerPerformerId, owner.performerId),
    owner.clientId === null
      ? isNull(attachment.draftOwnerClientId)
      : eq(attachment.draftOwnerClientId, owner.clientId),
  );
}

/** Project only display metadata and the authenticated download URL. */
export function deliverableOut(row: AttachmentRow): DeliverableOut {
  const mimeType = row.mimeType ?? 'application/octet-stream';
  const previewable =
    /^(image\/(?:jpeg|png|gif|webp)|audio\/(?:mpeg|mp4|ogg|wav|webm)|video\/(?:mp4|ogg|webm))$/u.test(
      mimeType.toLowerCase(),
    );
  return DeliverableOut.parse({
    id: row.id,
    title: row.title,
    fileName: row.fileName ?? row.title,
    mimeType,
    byteSize: row.byteSize ?? 0,
    downloadUrl: `/v1/orgs/${row.organizationId}/deliverables/${row.id}/download`,
    ...(previewable
      ? { previewUrl: `/v1/orgs/${row.organizationId}/deliverables/${row.id}/preview` }
      : {}),
  });
}

/** Compare every verified identity field of a private draft. */
export function sameDraftOwner(row: AttachmentRow, owner: DraftOwner): boolean {
  return (
    row.draftOwnerActorId === owner.actorId &&
    row.draftOwnerPerformerKind === owner.performerKind &&
    row.draftOwnerPerformerId === owner.performerId &&
    row.draftOwnerClientId === owner.clientId
  );
}

/** Keep storage addressing stable before and after a draft's bytes are acknowledged. */
export function draftBlobKey(orgId: string, id: string): string {
  return `attachments/${orgId}/${id}`;
}
