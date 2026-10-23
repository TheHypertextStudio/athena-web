import { db, externalResource } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { assertProductCapability } from '../product-capability';
import type { LibraryDetail, LibraryRef } from '../contracts/library';
import { loadVisibleDocuments, type SearchCaller } from '../search/query';
import { usedInForPage } from '../search/query-lookups';
import { filterVisibleRows, resolveCallerAccess } from '../search/query-visibility';
import type { ScoredRow } from '../search/query-types';
import {
  loadReadableAttachment,
  MAX_ATTACHMENT_BYTES,
  readAttachmentFile,
} from './attachment-file';
import { loadInboundReferences } from './entity-references';
import {
  libraryUri,
  scoreLibrarySource,
  summarizeLibraryResource,
  type LibrarySource,
} from './library-source';

/** Load current source and reapply the Library visibility policy without depending on index freshness. */
async function currentResource(
  caller: SearchCaller,
  ref: LibraryRef,
): Promise<{ source: LibrarySource; scored: ScoredRow }> {
  const accesses = await resolveCallerAccess(caller);
  const access = accesses.find((item) => item.organizationId === ref.orgId);
  if (!access) throw new NotFoundError();
  await assertProductCapability(ref.orgId, 'mcp');
  let source: LibrarySource | undefined;
  if (ref.kind === 'attachment') {
    source = await loadReadableAttachment(ref.orgId, access.actorId, ref.id);
  } else {
    [source] = await db
      .select()
      .from(externalResource)
      .where(
        and(
          eq(externalResource.id, ref.id),
          eq(externalResource.organizationId, ref.orgId),
          isNull(externalResource.archivedAt),
        ),
      )
      .limit(1);
  }
  if (!source) throw new NotFoundError();
  const scored = await scoreLibrarySource(ref, source);
  const visible = await filterVisibleRows([scored.row], {
    ownerUserId: caller.kind === 'user' ? caller.userId : null,
    accessByOrg: new Map(accesses.map((item) => [item.organizationId, item])),
  });
  if (visible.rows.length === 0) throw new NotFoundError();
  return { source, scored };
}

/** Read current metadata, visible usage and explicit uploaded-content availability. */
export async function readLibraryResource(
  caller: SearchCaller,
  ref: LibraryRef,
): Promise<LibraryDetail> {
  const { source, scored } = await currentResource(caller, ref);
  const usedIn = await usedInForPage([scored], caller);
  const usedBy = await resourceUsage(caller, ref, source);
  const file =
    'blobKey' in source
      ? await readAttachmentFile(source, MAX_ATTACHMENT_BYTES)
      : { status: 'unsupported' as const };
  const content =
    file.status === 'available'
      ? {
          status: file.status,
          uri: libraryUri(ref, true),
          mimeType: source.mimeType ?? 'application/octet-stream',
        }
      : { status: file.status };
  return {
    ...summarizeLibraryResource(ref, source, [...(usedIn.get(scored.row.id) ?? [])]),
    usedBy,
    content,
  };
}

async function resourceUsage(
  caller: SearchCaller,
  ref: LibraryRef,
  source: LibrarySource,
): Promise<LibraryDetail['usedBy']> {
  if ('canonicalUrl' in source) {
    return loadInboundReferences({
      caller,
      orgId: ref.orgId,
      targetKind: 'external_resource',
      targetId: ref.id,
    });
  }
  const documents = await loadVisibleDocuments({
    caller,
    orgId: ref.orgId,
    entityIds: [source.subjectId],
  });
  const subject = documents.find((row) => row.kind === source.subjectType);
  const href = subject?.route['href'];
  if (!subject || typeof href !== 'string') return { total: 0, groups: [] };
  return {
    total: 1,
    groups: [
      {
        subjectType: source.subjectType,
        items: [
          {
            subjectType: source.subjectType,
            subjectId: source.subjectId,
            title: subject.title,
            href,
          },
        ],
      },
    ],
  };
}

/** Read uploaded bytes after rechecking membership, source and subject visibility. */
export async function readLibraryContent(
  caller: SearchCaller,
  ref: LibraryRef,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { source } = await currentResource(caller, ref);
  if (!('blobKey' in source)) throw new NotFoundError();
  const file = await readAttachmentFile(source, MAX_ATTACHMENT_BYTES);
  if (file.status !== 'available') throw new NotFoundError();
  return { bytes: file.bytes, mimeType: source.mimeType ?? 'application/octet-stream' };
}
