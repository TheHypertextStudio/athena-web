import { actor } from '@docket/db';
import { canActor } from '@docket/authz';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  loadTemplateCopyActor,
  type TemplateCopyPrincipal,
} from '../templates/copy-reservation-context';

/** Authenticated adapter identity; receipt attribution and request JSON cannot supply this value. */
export type TemplateCopyUndoCaller =
  | { readonly orgId: string; readonly actorId: string }
  | { readonly orgId: string; readonly userId: string };

/** Nonhuman or detached callers receive ordinary adapter gates, without revealing a private receipt class. */
export async function isTemplateCopyUndoEligible(
  tx: TemplateTransaction,
  caller: TemplateCopyUndoCaller,
): Promise<boolean> {
  const [member] = await tx
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, caller.orgId),
        'actorId' in caller ? eq(actor.id, caller.actorId) : eq(actor.userId, caller.userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        isNotNull(actor.userId),
      ),
    )
    .limit(1);
  if (!member) return false;
  return (
    await canActor(
      member.id,
      'view',
      {
        kind: 'organization',
        id: caller.orgId,
        orgId: caller.orgId,
      },
      tx,
    )
  ).allow;
}

/** Resolve the current human principal independently of the copy receipt's accepting actor. */
export async function templateCopyUndoPrincipal(
  tx: TemplateTransaction,
  caller: TemplateCopyUndoCaller,
): Promise<TemplateCopyPrincipal> {
  if ('userId' in caller) return { organizationId: caller.orgId, userId: caller.userId };
  const [member] = await tx
    .select({ userId: actor.userId })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, caller.orgId),
        eq(actor.id, caller.actorId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .for('share');
  if (!member?.userId) throw new NotFoundError('Workspace not found');
  return { organizationId: caller.orgId, userId: member.userId };
}

/** Install only a freshly checked active caller for private registry recognition and copy Undo. */
export async function templateCopyUndoContext(
  tx: TemplateTransaction,
  caller: TemplateCopyUndoCaller,
): Promise<{
  readonly principal: TemplateCopyPrincipal;
  readonly actor: Awaited<ReturnType<typeof loadTemplateCopyActor>>;
}> {
  const principal = await templateCopyUndoPrincipal(tx, caller);
  return { principal, actor: await loadTemplateCopyActor(tx, principal, 'view') };
}
