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
  it.each([
    'steps',
    'tasks',
    'projects',
    'milestones',
    'taskLabels',
    'projectLabels',
    'dependencies',
  ])('rejects a missing %s source collection', (field) => {
    const row = source();
    expect(() => {
      verifyOriginalScheduleSource({ ...row, source: { ...row.source, [field]: null } });
    }).toThrow('source is incomplete');
  });
  it('refuses changed graph membership and source keys even when a fingerprint is unchanged', () => {
    const row = source();
    const steps = row.source['steps'] as Record<string, unknown>[];
    for (const changedSteps of [
      steps.slice(1),
      steps.map((step, index) => (index === 0 ? { ...step, id: 'unknown' } : step)),
    ])
      expect(() => {
        verifyOriginalScheduleSource({ ...row, source: { ...row.source, steps: changedSteps } });
      }).toThrow('source graph differs');
    expect(() => {
      verifyOriginalScheduleSource({
        ...row,
        source: { ...row.source, steps: steps.map((step) => ({ ...step, key: 'renamed' })) },
      });
    }).toThrow('source keys differ');
  });
  it('compares retained scalar fields and every immutable timing fact', () => {
    const row = source();
    expect(() => {
      verifyOriginalScheduleSource({
        ...row,
        overrides: row.overrides.filter((entry) => entry.kind !== 'task'),
      });
    }).toThrow('source fields differ');
    expect(() => {
      verifyOriginalScheduleSource({
        ...row,
        source: {
          ...row.source,
          tasks: [{ step_id: 'task', title: 'Changed title', project_step_id: 'project' }],
        },
      });
    }).toThrow('source fields differ');
    for (const difference of [
      { kind: 'milestone' },
      { timing: { kind: 'on_trigger', offsetDays: 1, afterStepId: null } },
      { timing: { kind: 'on_trigger', offsetDays: null, afterStepId: 'project' } },
      { timing: { kind: 'after_step', offsetDays: null, afterStepId: null } },
    ])
      expect(() => {
        verifyOriginalScheduleSource({
          ...row,
          overrides: row.overrides.map((entry) =>
            entry.kind === 'task' ? { ...entry, ...difference } : entry,
          ),
        } as ScheduleArchiveSource);
      }).toThrow('source timing differs');
  });
  it('matches both task and project labels as unordered original identities', () => {
    const row = source();
    const labeled = {
      ...row,
      source: {
        ...row.source,
        taskLabels: [
          { task_step_id: 'task', label_id: 'b' },
          { task_step_id: 'task', label_id: 'a' },
        ],
        projectLabels: [{ project_step_id: 'project', label_id: 'c' }],
      },
      overrides: row.overrides.map((entry) => ({
        ...entry,
        fields: { ...entry.fields, labelIds: entry.kind === 'task' ? ['a', 'b'] : ['c'] },
      })),
    };
    expect(() => {
      verifyOriginalScheduleSource(labeled);
    }).not.toThrow();
    expect(() => {
      verifyOriginalScheduleSource({ ...labeled, source: { ...labeled.source, taskLabels: [] } });
    }).toThrow('source labels differ');
  });
  it('compares dependency direction while ignoring storage order', () => {
    const row = source();
    const edges = [
      { blocking_step_id: 'project', blocked_step_id: 'task' },
      { blocking_step_id: 'task', blocked_step_id: 'project' },
    ];
    const dependencies = [
      { blockerStepId: 'task', blockedStepId: 'project' },
      { blockerStepId: 'project', blockedStepId: 'task' },
    ];
    const connected = {
      ...row,
      source: { ...row.source, dependencies: edges },
      manifest: { ...row.manifest, dependencies },
    };
    expect(() => {
      verifyOriginalScheduleSource(connected);
    }).not.toThrow();
    expect(() => {
      verifyOriginalScheduleSource({
        ...connected,
        source: { ...connected.source, dependencies: edges.slice(1) },
      });
    }).toThrow('source dependencies differ');
  });
  it('rejects malformed fingerprints and noninteger or negative source order', () => {
    const row = source();
    for (const fingerprints of [{ fingerprint: 'invalid' }, { originalFingerprint: 'invalid' }])
      expect(() => {
        verifyOriginalScheduleSource({ ...row, ...fingerprints });
      }).toThrow('ordering evidence');
    for (const sort of [-1, 0.5])
      expect(() => {
        verifyOriginalScheduleSource(changeSort(row, 'task', sort));
      }).toThrow('ordering is invalid');
  });
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
  it('requires one exact matching immutable projection for each projected child', () => {
    const row = source();
    const original = row.originalStepOrders[0];
    if (!original) throw new Error('Missing projection fixture');
    for (const originalStepOrders of [
      [],
      [original, original],
      [{ ...original, blueprintStepId: 'another-projection' }],
      [{ ...original, sourceVersionId: 'another-publication' }],
      [{ ...original, key: 'another-path' }],
      [{ ...original, kind: 'project' }],
      [{ ...original, sort: null }],
      [{ ...original, sort: -1, stepSort: -1, definitionSort: -1 }],
      [{ ...original, sort: 0.5, stepSort: 0.5, definitionSort: 0.5 }],
      [{ ...original, definitionSort: 6 }],
    ])
      expect(() => {
        verifyOriginalScheduleSource({ ...row, originalStepOrders });
      }).toThrow('ordering evidence');
  });
});
