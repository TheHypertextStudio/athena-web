import { workTemplateCopyBundle, workTemplateCopyEntry } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ConflictError } from '../../error';
import { loadTemplateCopyActor, type TemplateCopyPrincipal } from './copy-reservation-context';
import type { TemplateTransaction } from './persistence';

/** Original outcome only; source provenance/review bodies never enter this reconciliation projection. */
export interface TemplateCopyRequestStatus {
  readonly bundleId: string;
  readonly requestId: string;
  readonly state: 'installed' | 'undone';
  readonly mode: 'private_drafts' | 'published';
  readonly reviewFingerprint: string;
  readonly choicesFingerprint: string;
  readonly rootEntryKeys: readonly string[];
  readonly receiptId: string;
  readonly entries: readonly {
    readonly key: string;
    readonly workTypeId: string;
    readonly targetType: 'task' | 'project' | 'initiative' | 'program';
    readonly reservedFirstVersionId: string;
    readonly reservationState: 'pending' | 'consumed' | 'void';
  }[];
}
/**
 * Reconcile an unknown outcome for the current active acceptor with workspace view rights.
 * No source reads, authoring rights, new request identity or mutable destination writes are required.
 * Public callers attach only currently authorized destination projections.
 */
export async function getTemplateCopyBundleForRequest(
  tx: TemplateTransaction,
  principal: TemplateCopyPrincipal,
  requestId: string,
): Promise<TemplateCopyRequestStatus | null> {
  const key = z.string().min(1).max(128).parse(requestId);
  const live = await loadTemplateCopyActor(tx, principal, 'view');
  const [bundle] = await tx
    .select({
      bundleId: workTemplateCopyBundle.id,
      requestId: workTemplateCopyBundle.requestId,
      state: workTemplateCopyBundle.state,
      mode: workTemplateCopyBundle.mode,
      reviewFingerprint: workTemplateCopyBundle.reviewFingerprint,
      choicesFingerprint: workTemplateCopyBundle.choicesFingerprint,
      rootEntryKeys: workTemplateCopyBundle.rootEntryKeys,
      receiptId: workTemplateCopyBundle.receiptKey,
    })
    .from(workTemplateCopyBundle)
    .where(
      and(
        eq(workTemplateCopyBundle.organizationId, live.orgId),
        eq(workTemplateCopyBundle.acceptingActorKey, live.actorId),
        eq(workTemplateCopyBundle.requestId, key),
      ),
    )
    .limit(1);
  if (!bundle) return null;
  if (bundle.state === 'installing' || bundle.receiptId === null)
    throw new ConflictError('Copy installation is incomplete');
  const entries = await tx
    .select({
      key: workTemplateCopyEntry.entryKey,
      workTypeId: workTemplateCopyEntry.destinationWorkTypeId,
      targetType: workTemplateCopyEntry.targetType,
      reservedFirstVersionId: workTemplateCopyEntry.reservedFirstVersionId,
      reservationState: workTemplateCopyEntry.reservationState,
    })
    .from(workTemplateCopyEntry)
    .where(
      and(
        eq(workTemplateCopyEntry.organizationId, live.orgId),
        eq(workTemplateCopyEntry.bundleId, bundle.bundleId),
      ),
    )
    .orderBy(asc(workTemplateCopyEntry.ordinal));
  return { ...bundle, state: bundle.state, receiptId: bundle.receiptId, entries };
}
