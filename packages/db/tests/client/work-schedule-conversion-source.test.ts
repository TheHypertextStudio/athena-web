import { describe, expect, it } from 'vitest';
import { compileScheduleConversionInput } from '../../src/work-schedule-conversion-source';
import type { ScheduleArchiveSource } from '../../src/work-schedule-archive-source';
import { compileLegacyScheduleImport } from '@docket/work/schedule-import-compiler';

const project = '01K00000000000000000000001';
const task = '01K00000000000000000000002';
const publication = '01K00000000000000000000003';
const selected = [
  { reference: { rootKey: 'event', path: [] }, kind: 'project' as const },
  { reference: { rootKey: 'event', path: ['follow'] }, kind: 'task' as const },
];
const evidence = {
  kind: 'retained_source' as const,
  revision: 1 as const,
  revisionAlias: 'old-revision',
  invocationId: 'old-invocation',
  originalFingerprint: 'a'.repeat(32),
  archiveHash: 'sha256:' + 'b'.repeat(64),
};
function source(): ScheduleArchiveSource {
  return {
    source: {
      steps: [
        { id: task, key: 'Old follow', kind: 'task', sort: 4 },
        { id: project, key: 'Old event', kind: 'project', sort: 0 },
      ],
    },
    header: {},
    revisionAudit: { creation_mode: 'when_ready' },
    fingerprint: evidence.originalFingerprint,
    originalFingerprint: evidence.originalFingerprint,
    originalStepOrders: [],
    manifest: {
      kind: 'published',
      legacyProcessRevisionId: evidence.revisionAlias,
      roots: [
        {
          sourceStepId: project,
          sourceKey: 'Old event',
          key: 'event',
          kind: 'project',
          workTypeId: project,
          workTypeVersionId: publication,
        },
      ],
      steps: [
        {
          sourceStepId: task,
          sourceKey: 'Old follow',
          rootKey: 'event',
          path: ['follow'],
          blueprintStepId: task,
          sourceVersionId: publication,
        },
        {
          sourceStepId: project,
          sourceKey: 'Old event',
          rootKey: 'event',
          path: [],
          blueprintStepId: null,
          sourceVersionId: null,
        },
      ],
      dependencies: [],
    },
    overrides: [
      {
        sourceStepId: task,
        kind: 'task',
        fields: { title: 'Follow {month}', description: '', team_id: task, start_offset_days: -1 },
        timing: { kind: 'after_step_completion', afterStepId: project, offsetDays: 2 },
      },
      {
        sourceStepId: project,
        kind: 'project',
        fields: {
          name: 'Dinner {monthName}',
          description: null,
          lead_id: null,
          target_offset_days: 10,
        },
        timing: { kind: 'on_trigger', afterStepId: null, offsetDays: null },
      },
    ],
  };
}
describe('private original-source conversion projection', () => {
  it('preserves exact aliases, independent order, all literal date policies and blank replacement without restamping evidence', () => {
    const original = source(),
      before = JSON.stringify(original);
    // Use a non-Task prerequisite: old timing has no concrete Task completion fact and stays null.
    const input = compileScheduleConversionInput(
      original,
      evidence,
      selected,
      new Map(
        original.manifest.steps.map((step) => [
          step.sourceStepId,
          { rootKey: step.rootKey, path: [...step.path] },
        ]),
      ),
    );
    expect(input.sourceMappings.map((entry) => [entry.alias, entry.sourceKey, entry.sort])).toEqual(
      [
        [project, 'Old event', 0],
        [task, 'Old follow', 4],
      ],
    );
    expect(input.roots[0]?.root).toMatchObject({
      kind: 'project',
      fields: { description: '' },
      dates: {},
      responsibleActorId: null,
    });
    expect(input.roots[0]?.stepOverrides[0]).toMatchObject({
      kind: 'task',
      path: ['follow'],
      fields: { description: '' },
      dates: {},
    });
    expect(compileLegacyScheduleImport(input)).toMatchObject({
      kind: 'compiled_import',
      candidate: { creationMode: 'when_ready', source: evidence },
    });
    expect(original.fingerprint).toBe(evidence.originalFingerprint);
    expect(input.sourceBody).toEqual(original.source);
    expect(JSON.stringify(original)).toBe(before);
  });
  it('preserves genuine pending empty/null selections without publication resolution', () => {
    const base = source();
    const original = {
      ...base,
      manifest: {
        ...base.manifest,
        kind: 'pending_draft' as const,
        roots: base.manifest.roots.map((root) => ({
          ...root,
          workTypeId: null,
          workTypeVersionId: null,
        })),
      },
    };
    const input = compileScheduleConversionInput(
      original,
      evidence,
      [],
      new Map(
        original.manifest.steps.map((step) => [
          step.sourceStepId,
          { rootKey: step.rootKey, path: [...step.path] },
        ]),
      ),
    );
    expect(input.roots[0]?.template).toBeNull();
    expect(compileLegacyScheduleImport(input)).toMatchObject({
      kind: 'nonexecuting_import',
      pending: { disposition: 'pending_source', source: input },
    });
  });
  it('projects canonical publication paths separately from untouched original containment paths', () => {
    const base = source();
    const original = {
      ...base,
      manifest: {
        ...base.manifest,
        steps: base.manifest.steps.map((step) =>
          step.sourceStepId === task ? { ...step, path: ['checkpoint', 'follow'] } : step,
        ),
      },
    };
    const before = JSON.stringify(original);
    const references = new Map(
      original.manifest.steps.map((step) => [
        step.sourceStepId,
        { rootKey: step.rootKey, path: step.sourceStepId === task ? ['follow'] : [] },
      ]),
    );
    const input = compileScheduleConversionInput(original, evidence, selected, references);
    expect(input.sourceMappings.find((entry) => entry.alias === task)?.reference.path).toEqual([
      'follow',
    ]);
    expect(input.roots[0]?.stepOverrides[0]?.path).toEqual(['follow']);
    expect(JSON.stringify(original)).toBe(before);
    expect(original.manifest.steps[0]?.path).toEqual(['checkpoint', 'follow']);
  });
});
