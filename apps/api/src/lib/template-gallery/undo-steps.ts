import {
  template,
  workTemplateCopyBundle,
  workTemplateCopyEntry,
  workTypeTeam,
  type TemplateCopyUndoOutcome,
} from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateCopyBundleRow, TemplateCopyEntryRow } from '../templates/copy-reservation';
import type { TemplateCopyPrincipal } from '../templates/copy-reservation-context';
import { templateCopyBundleMemberInUse } from '../templates/copy-reference-integrity';
import type { TemplateRow } from '../templates/model';
import type { TemplateTransaction } from '../templates/persistence';
import { fingerprintCopiedTemplateState } from './copy-state';
import { planTemplateCopyUndo, type CopyUndoStep } from './undo-plan';

/** Compare canonical authored facts; the mutable reference epoch never enters edit detection. */
export async function templateCopyUndoSteps(
  tx: TemplateTransaction,
  bundle: TemplateCopyBundleRow,
  entries: readonly TemplateCopyEntryRow[],
  rows: ReadonlyMap<string, TemplateRow>,
): Promise<CopyUndoStep[]> {
  const offerings = await tx
    .select()
    .from(workTypeTeam)
    .where(
      and(
        eq(workTypeTeam.organizationId, bundle.organizationId),
        inArray(
          workTypeTeam.workTypeId,
          entries.map((entry) => entry.destinationWorkTypeId),
        ),
      ),
    );
  const facts = await Promise.all(
    entries.map(async (entry) => {
      const row = rows.get(entry.destinationWorkTypeId);
      if (!row || !entry.afterStateFingerprint)
        throw new ConflictError('Copy can no longer be undone');
      const current = await fingerprintCopiedTemplateState(
        row,
        offerings
          .filter((offering) => offering.workTypeId === row.id)
          .map((offering) => offering.teamId),
        entry.reservationState,
      );
      return {
        key: entry.entryKey,
        dependencies: entry.dependencyEntryKeys,
        reservationState: entry.reservationState,
        changed: current !== entry.afterStateFingerprint,
      };
    }),
  );
  return planTemplateCopyUndo(facts);
}

/** Remove one unused private copy, retaining its immutable void identity tombstone. */
async function removePrivateCopy(
  tx: TemplateTransaction,
  entry: TemplateCopyEntryRow,
): Promise<void> {
  await tx
    .update(workTemplateCopyEntry)
    .set({ reservationState: 'void', liveWorkTypeId: null })
    .where(
      and(
        eq(workTemplateCopyEntry.id, entry.id),
        eq(workTemplateCopyEntry.organizationId, entry.organizationId),
      ),
    );
  await tx
    .delete(template)
    .where(
      and(
        eq(template.organizationId, entry.organizationId),
        eq(template.id, entry.destinationWorkTypeId),
      ),
    );
}

/** Process parents first, checking actual live references after every preceding tentative removal. */
export async function applyTemplateCopyUndoStep(
  tx: TemplateTransaction,
  principal: TemplateCopyPrincipal,
  input: {
    readonly bundleId: string;
    readonly entry: TemplateCopyEntryRow;
    readonly action: CopyUndoStep['action'];
  },
): Promise<TemplateCopyUndoOutcome> {
  const { bundleId, entry, action } = input;
  if (action === 'retain_changed') return { entryKey: entry.entryKey, outcome: 'retained_changed' };
  if (action === 'archive') {
    await tx
      .update(template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(
        and(
          eq(template.organizationId, entry.organizationId),
          eq(template.id, entry.destinationWorkTypeId),
        ),
      );
    return { entryKey: entry.entryKey, outcome: 'archived' };
  }
  if (await templateCopyBundleMemberInUse(tx, principal, { bundleId, entryKey: entry.entryKey }))
    return { entryKey: entry.entryKey, outcome: 'retained_in_use' };
  await removePrivateCopy(tx, entry);
  return { entryKey: entry.entryKey, outcome: 'deleted' };
}

/** Persist all outcomes atomically with the original aggregate receipt reversal. */
export async function finishTemplateCopyUndo(
  tx: TemplateTransaction,
  bundle: TemplateCopyBundleRow,
  outcomes: readonly TemplateCopyUndoOutcome[],
): Promise<void> {
  await tx
    .update(workTemplateCopyBundle)
    .set({ state: 'undone', undoneAt: new Date(), undoOutcomes: outcomes })
    .where(
      and(
        eq(workTemplateCopyBundle.organizationId, bundle.organizationId),
        eq(workTemplateCopyBundle.id, bundle.id),
      ),
    );
}
