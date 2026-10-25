import {
  appendImportedHistoryPage,
  beginImportedHistoryPreparation,
  finishImportedHistoryPreparation,
  prepareImportedHistoryPage,
  type ImportedHistoryPreparation,
} from '@docket/work/schedule-import-receipt';
import {
  ImportedHistoricalReference,
  type ImportedHistoryReceipt,
} from '@docket/work/work-schedule-import-receipt';
import { readScheduleHistoricalReferences } from './work-schedule-history';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import type { ScheduleHistoryImportProof } from './work-schedule-history-import-proof';
import type { BlueprintMigrationConnection } from './work-template-blueprint-migration/query';

function physicalId(
  mapping: Record<string, unknown> | undefined,
  selected: Record<string, unknown> | undefined,
  original: Readonly<Record<string, unknown>>,
): unknown {
  return (
    mapping?.['task_id'] ??
    mapping?.['project_id'] ??
    mapping?.['milestone_id'] ??
    selected?.['id'] ??
    original['workId']
  );
}
function reference(original: Readonly<Record<string, unknown>>): ImportedHistoricalReference {
  const mapping = original['mapping'] as Record<string, unknown> | undefined;
  const selected = original['selection'] as Record<string, unknown> | undefined;
  const kind = original['kind'] ?? selected?.['kind'];
  const id = physicalId(mapping, selected, original);
  const parsed = ImportedHistoricalReference.safeParse({
    sourceStepAlias: mapping?.['step_id'] ?? original['sourceStepId'] ?? null,
    sourceKey: original['sourceKey'] ?? null,
    // An archived path/key cannot establish an original selected publication or physical origin.
    logical: null,
    work: { kind, id },
    presence: original['deleted'] === true ? 'tombstone' : 'live',
    parent: null,
    origin: null,
    publication: null,
    original,
  });
  if (!parsed.success) throw new ScheduleSourceProofError('history_identity_unproved');
  return parsed.data;
}
/** Consume every immutable original reference in bounded pages; unknown origins remain explicitly unproved. */
export async function prepareScheduleHistoryPages(
  tx: BlueprintMigrationConnection,
  proof: ScheduleHistoryImportProof,
): Promise<ImportedHistoryReceipt> {
  let state: ImportedHistoryPreparation | undefined;
  let offset = 0;
  for (;;) {
    const page = await readScheduleHistoricalReferences(tx, {
      organizationId: proof.identity.organizationId,
      occurrenceId: proof.identity.occurrenceId,
      offset,
    });
    const prepared = prepareImportedHistoryPage({
      identity: proof.identity,
      source: proof.source,
      historicalArchiveHash: proof.historicalArchiveHash,
      originalRootRefs: proof.originalRootRefs,
      totalReferences: proof.referenceCount,
      offset,
      nextOffset: page.nextOffset,
      references: page.references.map(reference),
      sourceMappings: [],
      actualRows: [],
    });
    state = appendImportedHistoryPage(state ?? beginImportedHistoryPreparation(prepared), prepared);
    if (page.nextOffset === null) return finishImportedHistoryPreparation(state);
    offset = page.nextOffset;
  }
}
