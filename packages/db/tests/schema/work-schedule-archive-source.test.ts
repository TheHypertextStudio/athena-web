import { describe, expect, it } from 'vitest';
import {
  verifyOriginalScheduleSource,
  type ScheduleArchiveSource,
} from '../../src/work-schedule-archive-source';

function source(): ScheduleArchiveSource {
  const project = { step_id: 'project', name: 'Dinner' };
  const task = { step_id: 'task', title: 'Prepare dinner', project_step_id: 'project' };
  return {
    fingerprint: 'a'.repeat(32),
    originalFingerprint: 'a'.repeat(32),
    source: {
      definition: { id: 'definition', name: 'Dinner', description: null, status: 'published' },
      revision: { id: 'revision', number: 1 },
      steps: [
        {
          id: 'task',
          key: 'prepare',
          kind: 'task',
          sort: 5,
          timing_kind: 'on_trigger',
          offset_days: null,
          after_step_id: null,
        },
        {
          id: 'project',
          key: 'dinner',
          kind: 'project',
          sort: 27,
          timing_kind: 'on_trigger',
          offset_days: null,
          after_step_id: null,
        },
      ],
      projects: [project],
      tasks: [task],
      milestones: [],
      taskLabels: [],
      projectLabels: [],
      dependencies: [],
    },
    header: { id: 'definition', name: 'Dinner' },
    revisionAudit: { id: 'revision', number: 1 },
    manifest: {
      kind: 'published',
      legacyProcessRevisionId: 'revision',
      roots: [
        {
          sourceStepId: 'project',
          sourceKey: 'dinner',
          key: 'dinner',
          kind: 'project',
          workTypeId: 'template',
          workTypeVersionId: 'version',
        },
      ],
      steps: [
        {
          sourceStepId: 'project',
          sourceKey: 'dinner',
          rootKey: 'dinner',
          path: [],
          blueprintStepId: null,
          sourceVersionId: null,
        },
        {
          sourceStepId: 'task',
          sourceKey: 'prepare',
          rootKey: 'dinner',
          path: ['prepare'],
          blueprintStepId: 'projection',
          sourceVersionId: 'version',
        },
      ],
      dependencies: [],
    },
    overrides: [
      {
        sourceStepId: 'project',
        kind: 'project',
        fields: project,
        timing: { kind: 'on_trigger', offsetDays: null, afterStepId: null },
      },
      {
        sourceStepId: 'task',
        kind: 'task',
        fields: task,
        timing: { kind: 'on_trigger', offsetDays: null, afterStepId: null },
      },
    ],
    originalStepOrders: [
      {
        sourceStepId: 'task',
        blueprintStepId: 'projection',
        sourceVersionId: 'version',
        key: 'prepare',
        kind: 'task',
        sort: 5,
        stepSort: 5,
        definitionSort: 5,
      },
    ],
  };
}
function changed(row: ScheduleArchiveSource): ScheduleArchiveSource {
  return { ...row, fingerprint: 'b'.repeat(32) };
}
function changeSort(row: ScheduleArchiveSource, id: string, sort: number): ScheduleArchiveSource {
  return {
    ...changed(row),
    source: {
      ...row.source,
      steps: (row.source['steps'] as Record<string, unknown>[]).map((step) =>
        step['id'] === id ? { ...step, sort } : step,
      ),
    },
  };
}
describe('original retained source ordering proof', () => {
  it('accepts an unchanged original whole MD5 and explicit child projection sort, without deriving root sort from array position', () => {
    expect(() => {
      verifyOriginalScheduleSource(source());
    }).not.toThrow();
  });
  it('preserves independently mutable audit header facts excluded from the original source MD5', () => {
    const row = source();
    expect(() => {
      verifyOriginalScheduleSource({
        ...row,
        header: { ...row.header, updated_at: '2026-10-15T00:00:00Z' },
      });
    }).not.toThrow();
  });
  it('rejects a child sort-only mutation against its immutable original publication', () => {
    expect(() => {
      verifyOriginalScheduleSource(changeSort(source(), 'task', 6));
    }).toThrow('ordering differs');
  });
  it('rejects root sort-only mutation when the original whole MD5 no longer proves the unprojected root', () => {
    expect(() => {
      verifyOriginalScheduleSource(changeSort(source(), 'project', 28));
    }).toThrow('ordering cannot be proved');
  });
  it('retains legacy sources after a legitimate header edit if independent original root ordering was never captured', () => {
    const row = source();
    const edited = {
      ...changed(row),
      source: {
        ...row.source,
        definition: {
          id: 'definition',
          name: 'Renamed Dinner',
          description: null,
          status: 'published',
        },
      },
      header: { ...row.header, name: 'Renamed Dinner' },
    };
    expect(() => {
      verifyOriginalScheduleSource(edited);
    }).toThrow('ordering cannot be proved');
  });
  it('accepts unchanged pending sources but rejects changed pending order without original publication facts', () => {
    const row = source();
    const pending: ScheduleArchiveSource = {
      ...row,
      originalStepOrders: [],
      manifest: {
        ...row.manifest,
        kind: 'pending_draft',
        roots: row.manifest.roots.map((root) => ({
          ...root,
          workTypeId: null,
          workTypeVersionId: null,
        })),
        steps: row.manifest.steps.map((step) => ({
          ...step,
          blueprintStepId: null,
          sourceVersionId: null,
        })),
      },
    };
    expect(() => {
      verifyOriginalScheduleSource(pending);
    }).not.toThrow();
    expect(() => {
      verifyOriginalScheduleSource(changed(pending));
    }).toThrow('ordering cannot be proved');
  });
  it('refuses conflicting mutable projection columns rather than treating them as original immutable order', () => {
    const row = source();
    const original = row.originalStepOrders[0];
    if (!original) throw new Error('Missing projection fixture');
    expect(() => {
      verifyOriginalScheduleSource({ ...row, originalStepOrders: [{ ...original, sort: 99 }] });
    }).toThrow('ordering evidence');
  });
});
