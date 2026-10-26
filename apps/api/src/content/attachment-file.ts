import { actor, attachment, db, initiative, program, project, role } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { assertPostVisible } from './post-access';
import { getContainer } from '../container';
import { NotFoundError } from '../error';
import { buildTaskViewFilter, loadTask } from '../routes/task-helpers';
import { resolveResourceAccessForActors, resourceAccessKey } from '../permissions/resource-access';

/** Maximum supported uploaded attachment size, shared by upload and MCP reads. */
export { MAX_ATTACHMENT_BYTES } from '@docket/work/attachment-contract';

/** Load an active attachment after checking its current subject, independently of the search index. */
export async function loadReadableAttachment(
  orgId: string,
  actorId: string,
  id: string,
  taskId?: string,
): Promise<typeof attachment.$inferSelect> {
  const [row] = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.id, id),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  if (!row || (taskId !== undefined && (row.subjectType !== 'task' || row.subjectId !== taskId))) {
    throw new NotFoundError();
  }
  if (row.subjectType === 'draft') throw new NotFoundError();
  if (row.subjectType === 'comment' || row.subjectType === 'update') {
    await assertPostVisible(orgId, actorId, row.subjectType, row.subjectId);
  } else if (row.subjectType === 'task') {
    const target = await loadTask(orgId, row.subjectId);
    const canView = await buildTaskViewFilter(orgId, actorId);
    if (!canView(target)) throw new NotFoundError();
  } else {
    await assertContainerAttachmentVisible(row, actorId);
  }
  return row;
}

async function assertContainerAttachmentVisible(
  row: typeof attachment.$inferSelect,
  actorId: string,
): Promise<void> {
  if (
    row.subjectType !== 'project' &&
    row.subjectType !== 'initiative' &&
    row.subjectType !== 'program'
  )
    throw new NotFoundError();
  const orgId = row.organizationId;
  const table =
    row.subjectType === 'project' ? project : row.subjectType === 'program' ? program : initiative;
  const [subject] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(eq(table.id, row.subjectId), eq(table.organizationId, orgId), isNull(table.archivedAt)),
    )
    .limit(1);
  const [identity] = await db
    .select({
      kind: actor.kind,
      roleId: actor.roleId,
      roleKey: role.key,
      visibility: role.defaultVisibility,
    })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(actor.organizationId, role.organizationId)))
    .where(
      and(
        eq(actor.id, actorId),
        eq(actor.organizationId, orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!subject || !identity) throw new NotFoundError();
  const ref = { kind: row.subjectType, id: row.subjectId, organizationId: orgId };
  const access = await resolveResourceAccessForActors(
    [
      {
        organizationId: orgId,
        actorId,
        roleId: identity.roleId,
        isGuest:
          identity.kind === 'agent' ||
          identity.roleKey === 'guest' ||
          identity.visibility === 'private',
      },
    ],
    [ref],
  );
  if (!access.get(resourceAccessKey(ref))?.canView) throw new NotFoundError();
}

/** A bounded attachment read; absent bytes and oversized legacy files remain distinguishable. */
export type AttachmentFile =
  | { status: 'available'; bytes: Uint8Array }
  | { status: 'unsupported' | 'unavailable' | 'too_large' };

/** Read authorized bytes, optionally bounding declared and actual sizes for MCP encoding. */
export async function readAttachmentFile(
  row: typeof attachment.$inferSelect,
  maxBytes?: number,
): Promise<AttachmentFile> {
  if (row.kind !== 'file') return { status: 'unsupported' };
  if (maxBytes !== undefined && (row.byteSize ?? 0) > maxBytes) return { status: 'too_large' };
  if (!row.blobKey) return { status: 'unavailable' };
  const bytes = await getContainer().blob.get(row.blobKey);
  if (!bytes) return { status: 'unavailable' };
  return maxBytes !== undefined && bytes.byteLength > maxBytes
    ? { status: 'too_large' }
    : { status: 'available', bytes };
}
