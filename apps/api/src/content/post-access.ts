import { actor, comment, db, role, update } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { resolveResourceAccessForActors, resourceAccessKey } from '../permissions/resource-access';
import { buildTaskViewFilter, loadTask } from '../routes/task-helpers';

/** Resolve the live parent of a comment or update without trusting saved attachment metadata. */
export async function postSubject(
  orgId: string,
  kind: 'comment' | 'update',
  id: string,
): Promise<{ kind: 'task' | 'project' | 'program' | 'initiative' | 'cycle'; id: string }> {
  const table = kind === 'comment' ? comment : update;
  const [post] = await db
    .select({ kind: table.subjectType, id: table.subjectId })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, id), isNull(table.archivedAt)))
    .limit(1);
  if (!post) throw new NotFoundError();
  return post;
}

/** Require current parent visibility before exposing a post's files. */
export async function assertPostVisible(
  orgId: string,
  actorId: string,
  kind: 'comment' | 'update',
  id: string,
): Promise<void> {
  const subject = await postSubject(orgId, kind, id);
  if (subject.kind === 'task') {
    const task = await loadTask(orgId, subject.id);
    if (!(await buildTaskViewFilter(orgId, actorId))(task)) throw new NotFoundError();
    return;
  }
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
  if (!identity) throw new NotFoundError();
  const ref = { kind: subject.kind, id: subject.id, organizationId: orgId };
  const accesses = await resolveResourceAccessForActors(
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
  if (!accesses.get(resourceAccessKey(ref))?.canView) throw new NotFoundError();
}
