import { template, workTemplateCopyBundle, workTemplateCopyEntry } from '@docket/db';
import type { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';
import { CapabilityError, ConflictError } from '../../error';
import type { TemplateActor } from './authorization';
import { loadTemplateCopyActor } from './copy-reservation-context';
import {
  requireTemplateCopyReservation,
  type TemplateCopyReservation,
  type TemplateCopyReservationFacts,
} from './copy-reservation-proof';
import type { TemplateTransaction } from './persistence';

/** Recheck exact persisted reservation, current verified user and personal ownership before insert. */
export async function claimReservedTemplateIdentity(
  tx: TemplateTransaction,
  capability: TemplateCopyReservation,
  actor: TemplateActor,
  body: WorkTemplateCreate,
): Promise<string> {
  const facts = requireTemplateCopyReservation(tx, capability, actor);
  const live = await loadTemplateCopyActor(tx, {
    organizationId: facts.organizationId,
    userId: facts.userId,
  });
  if (
    live.actorId !== facts.actorId ||
    body.scope !== 'personal' ||
    (body.ownerActorId ?? live.actorId) !== live.actorId
  )
    throw new CapabilityError();
  const [row] = await tx
    .select({
      entry: workTemplateCopyEntry,
      bundleState: workTemplateCopyBundle.state,
      acceptor: workTemplateCopyBundle.acceptingActorId,
    })
    .from(workTemplateCopyEntry)
    .innerJoin(
      workTemplateCopyBundle,
      and(
        eq(workTemplateCopyBundle.id, workTemplateCopyEntry.bundleId),
        eq(workTemplateCopyBundle.organizationId, workTemplateCopyEntry.organizationId),
      ),
    )
    .where(
      and(
        eq(workTemplateCopyEntry.id, facts.entryId),
        eq(workTemplateCopyEntry.organizationId, facts.organizationId),
        eq(workTemplateCopyEntry.bundleId, facts.bundleId),
      ),
    )
    .for('update');
  if (
    row?.bundleState !== 'installing' ||
    row.acceptor !== live.actorId ||
    !matchesReservation(row.entry, facts, body)
  )
    throw new ConflictError('Copy reservation is unavailable');
  const [created] = await tx
    .select({ id: template.id })
    .from(template)
    .where(eq(template.id, facts.destinationWorkTypeId));
  if (created) throw new ConflictError('Copy identity was already created');
  return facts.destinationWorkTypeId;
}

function matchesReservation(
  entry: typeof workTemplateCopyEntry.$inferSelect,
  facts: TemplateCopyReservationFacts,
  body: WorkTemplateCreate,
): boolean {
  return (
    entry.reservationState === 'pending' &&
    entry.liveWorkTypeId === facts.destinationWorkTypeId &&
    entry.destinationWorkTypeId === facts.destinationWorkTypeId &&
    entry.reservedFirstVersionId === facts.reservedFirstVersionId &&
    entry.targetType === body.targetType
  );
}
