import { changeSet, workTemplateCopyBundle, workTemplateCopyEntry } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError, ValidationError } from '../../error';
import { loadTemplateCopyActor } from './copy-reservation-context';
import {
  requireTemplateCopyReservation,
  type TemplateCopyReservation,
} from './copy-reservation-proof';
import type { TemplateTransaction } from './persistence';
/** Original exact per-entry receipt hashes, computed from canonical final rows and explicit offerings. */
export interface TemplateCopyFinishInput {
  readonly receiptId: string;
  readonly afterStateFingerprints: readonly {
    readonly key: string;
    readonly fingerprint: string;
  }[];
}
/** Complete the same atomic installation; a partial bundle must never survive transaction commit. */
export async function finishTemplateCopyBundleInTransaction(
  tx: TemplateTransaction,
  capability: TemplateCopyReservation,
  input: TemplateCopyFinishInput,
): Promise<void> {
  const facts = requireTemplateCopyReservation(tx, capability);
  const live = await loadTemplateCopyActor(tx, {
    organizationId: facts.organizationId,
    userId: facts.userId,
  });
  if (live.actorId !== facts.actorId) throw new ConflictError('Copy accepting identity changed');
  const [bundle] = await tx
    .select()
    .from(workTemplateCopyBundle)
    .where(
      and(
        eq(workTemplateCopyBundle.id, facts.bundleId),
        eq(workTemplateCopyBundle.organizationId, live.orgId),
      ),
    )
    .for('update');
  if (bundle?.state !== 'installing' || bundle.acceptingActorId !== live.actorId)
    throw new ConflictError('Copy installation changed');
  const [receipt] = await tx
    .select({ id: changeSet.id })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, input.receiptId),
        eq(changeSet.organizationId, live.orgId),
        eq(changeSet.actorId, live.actorId),
      ),
    );
  if (!receipt) throw new ConflictError('Copy receipt is unavailable');
  const entries = await tx
    .select({ id: workTemplateCopyEntry.id, key: workTemplateCopyEntry.entryKey })
    .from(workTemplateCopyEntry)
    .where(
      and(
        eq(workTemplateCopyEntry.bundleId, bundle.id),
        eq(workTemplateCopyEntry.organizationId, live.orgId),
      ),
    );
  const fingerprints = finishFingerprints(
    input,
    entries.map((entry) => entry.key),
  );
  for (const entry of entries)
    await tx
      .update(workTemplateCopyEntry)
      .set({ afterStateFingerprint: fingerprints.get(entry.key) ?? null })
      .where(eq(workTemplateCopyEntry.id, entry.id));
  await tx
    .update(workTemplateCopyBundle)
    .set({
      state: 'installed',
      receiptKey: receipt.id,
      receiptId: receipt.id,
      installedAt: new Date(),
    })
    .where(eq(workTemplateCopyBundle.id, bundle.id));
}
function finishFingerprints(
  input: TemplateCopyFinishInput,
  keys: readonly string[],
): ReadonlyMap<string, string> {
  const hashes = new Map(
    input.afterStateFingerprints.map((entry) => [entry.key, entry.fingerprint]),
  );
  if (
    hashes.size !== keys.length ||
    input.afterStateFingerprints.length !== keys.length ||
    keys.some((key) => !/^sha256:[0-9a-f]{64}$/.test(hashes.get(key) ?? ''))
  )
    throw new ValidationError([
      { path: ['afterStateFingerprints'], message: 'Record every copied template once.' },
    ]);
  return hashes;
}
