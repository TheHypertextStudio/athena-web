import { ImportedHistoryPageInput } from '../src/contracts/work-schedule-import-receipt';
/** One bounded exact old history page with real-pair-shaped descriptive source facts, never accepted authority. */
export function historyPageFixture(offset = 0): ImportedHistoryPageInput {
  const logical = { rootKey: 'event', path: [`source-${offset}`] };
  const work = { kind: 'task', id: `original-physical-${offset}` };
  const parent = { kind: 'project', id: 'original-project' };
  const origin = {
    publicationVersionId: 'exact-parent-publication',
    blueprintStepId: `exact-parent-step-${offset}`,
  };
  const publication = { workTypeId: 'exact-child-template', versionId: 'exact-child-publication' };
  return ImportedHistoryPageInput.parse({
    identity: {
      organizationId: 'original-tenant',
      occurrenceId: 'original-occurrence',
      seriesId: 'original-series',
      seriesRevisionId: 'original-series-revision',
      instanceAlias: 'original-instance',
      externalOccurrenceKey: 'original-provider-key',
      scheduledFor: '2026-10-15',
      originalScheduledFor: '2026-10-01',
      runKind: 'scheduled',
      status: 'completed',
    },
    source: {
      kind: 'retained_source',
      revision: 1,
      revisionAlias: 'original-revision',
      invocationId: 'original-invocation',
      originalFingerprint: 'a'.repeat(32),
      archiveHash: 'sha256:' + 'b'.repeat(64),
    },
    historicalArchiveHash: 'sha256:' + 'c'.repeat(64),
    totalReferences: 502,
    offset,
    nextOffset: offset + 1,
    originalRootRefs: [{ key: '0legacy-event', kind: 'project', id: 'original-project' }],
    references: [
      {
        sourceStepAlias: `original-step-${offset}`,
        sourceKey: `0legacy-key-${offset}`,
        logical,
        work,
        presence: 'live',
        parent,
        origin,
        publication,
        original: {
          kind: 'task',
          mapping: { step_id: `original-step-${offset}`, task_id: work.id },
          sourceKey: `0legacy-key-${offset}`,
          privateMarkdown: '\n![Original](library-file:private)\n',
          deleted: false,
        },
      },
    ],
    sourceMappings: [
      {
        alias: `original-step-${offset}`,
        sourceKey: `0legacy-key-${offset}`,
        reference: logical,
        kind: 'task',
        sort: offset,
      },
    ],
    actualRows: [
      {
        organizationId: 'original-tenant',
        occurrenceId: 'original-occurrence',
        work,
        logical,
        parent,
        origin,
        publication,
      },
    ],
  });
}
