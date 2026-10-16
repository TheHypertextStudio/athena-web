import { genId, workTemplateCopyBundle, workTemplateCopyEntry } from '@docket/db';
import { fingerprintCopyFacts } from '@docket/work/template-copy';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { requireTemplateAuthor } from './authorization';
import { ConflictError } from '../../error';
import {
  loadTemplateCopyActor,
  requireCopySerializable,
  type TemplateCopyPrincipal,
} from './copy-reservation-context';
import { parseCopyBundleAcceptance, type CopyBundleAcceptance } from './copy-reservation-input';
import {
  registerTemplateCopyReservation,
  type TemplateCopyReservation,
} from './copy-reservation-proof';
import type { TemplateTransaction } from './persistence';
export { getTemplateCopyBundleForRequest } from './copy-reservation-status';
export { finishTemplateCopyBundleInTransaction } from './copy-reservation-finish';
export type { TemplateCopyRequestStatus } from './copy-reservation-status';
export type { TemplateCopyPrincipal } from './copy-reservation-context';
export type { CopyBundleAcceptance } from './copy-reservation-input';
export type { TemplateCopyReservation } from './copy-reservation-proof';

/** Private persisted bundle metadata; public projections must explicitly redact its source/audit fields. */
export type TemplateCopyBundleRow = typeof workTemplateCopyBundle.$inferSelect;
/** Private provenance/reservation row; no reusable definition/version is duplicated here. */
export type TemplateCopyEntryRow = typeof workTemplateCopyEntry.$inferSelect;
/** A terminal idempotent retry cannot recreate definitions or overwrite their later authored edits. */
export type TemplateCopyReservationResult =
  | {
      readonly kind: 'existing';
      readonly bundle: TemplateCopyBundleRow;
      readonly entries: readonly TemplateCopyEntryRow[];
    }
  | {
      readonly kind: 'reserved';
      readonly bundle: TemplateCopyBundleRow;
      readonly entries: readonly TemplateCopyEntryRow[];
      readonly actor: ActorCtx;
      readonly reservations: ReadonlyMap<string, TemplateCopyReservation>;
    };

/**
 * Reserve canonical pairs after the enclosing service authorizes/freezes sources and review decisions.
 * This server boundary rechecks the actual destination user, policy and actor-scoped request identity.
 * @throws On stale/mismatched retries, inactive membership, authoring refusal or a nonserializable owner.
 */
export async function reserveTemplateCopyBundleInTransaction(
  tx: TemplateTransaction,
  principal: TemplateCopyPrincipal,
  input: CopyBundleAcceptance,
): Promise<TemplateCopyReservationResult> {
  const accepted = parseCopyBundleAcceptance(input);
  await requireCopySerializable(tx);
  const live = await loadTemplateCopyActor(tx, principal, 'view');
  const requestFingerprint = await fingerprintCopyFacts(accepted);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['copy-request', live.orgId, live.actorId, accepted.requestId])},0))`,
  );
  const [existing] = await tx
    .select()
    .from(workTemplateCopyBundle)
    .where(
      and(
        eq(workTemplateCopyBundle.organizationId, live.orgId),
        eq(workTemplateCopyBundle.acceptingActorKey, live.actorId),
        eq(workTemplateCopyBundle.requestId, accepted.requestId),
      ),
    )
    .for('update');
  if (existing) return existingReservation(tx, existing, requestFingerprint);
  await requireTemplateAuthor(live, tx);
  const [bundle] = await tx
    .insert(workTemplateCopyBundle)
    .values({
      organizationId: live.orgId,
      acceptingActorKey: live.actorId,
      acceptingActorId: live.actorId,
      requestId: accepted.requestId,
      requestFingerprint,
      reviewFingerprint: accepted.reviewFingerprint,
      choicesFingerprint: accepted.choicesFingerprint,
      mode: accepted.mode,
      rootEntryKeys: accepted.roots,
    })
    .returning();
  if (!bundle) throw new Error('Copy reservation insert returned no bundle');
  const entries = await reserveEntries(tx, live, bundle.id, accepted);
  const reservations = new Map(
    entries.map((entry) => [
      entry.entryKey,
      registerTemplateCopyReservation(tx, {
        entryId: entry.id,
        bundleId: bundle.id,
        organizationId: live.orgId,
        actorId: live.actorId,
        userId: principal.userId,
        destinationWorkTypeId: entry.destinationWorkTypeId,
        reservedFirstVersionId: entry.reservedFirstVersionId,
      }),
    ]),
  );
  return { kind: 'reserved', bundle, entries, actor: live, reservations };
}
async function existingReservation(
  tx: TemplateTransaction,
  bundle: TemplateCopyBundleRow,
  fingerprint: string,
): Promise<TemplateCopyReservationResult> {
  if (bundle.requestFingerprint !== fingerprint || bundle.state === 'installing')
    throw new ConflictError('Copy request changed');
  const entries = await tx
    .select()
    .from(workTemplateCopyEntry)
    .where(
      and(
        eq(workTemplateCopyEntry.bundleId, bundle.id),
        eq(workTemplateCopyEntry.organizationId, bundle.organizationId),
      ),
    )
    .orderBy(asc(workTemplateCopyEntry.ordinal));
  return { kind: 'existing', bundle, entries };
}

async function reserveEntries(
  tx: TemplateTransaction,
  live: ActorCtx,
  bundleId: string,
  accepted: CopyBundleAcceptance,
): Promise<TemplateCopyEntryRow[]> {
  return await tx
    .insert(workTemplateCopyEntry)
    .values(
      accepted.entries.map((entry, ordinal) => {
        const destinationWorkTypeId = genId();
        return {
          organizationId: live.orgId,
          bundleId,
          entryKey: entry.key,
          targetType: entry.kind,
          ordinal,
          destinationWorkTypeId,
          liveWorkTypeId: destinationWorkTypeId,
          reservedFirstVersionId: genId(),
          sourceIdentity: entry.source,
          sourceFingerprint: entry.sourceFingerprint,
          dependencyEntryKeys: entry.dependencies,
        };
      }),
    )
    .returning();
}
