import { describe, expect, it } from 'vitest';
import type { BlueprintInvocationOverride, BlueprintInvocationStep } from '@docket/db';
import { compileRetainedPreset } from '../../src/lib/work-template-blueprints/retained-overrides';
const source: BlueprintInvocationStep = {
  sourceStepId: 'source',
  sourceKey: 'report',
  rootKey: 'report',
  path: [],
  blueprintStepId: null,
  sourceVersionId: null,
};
function preset(
  fields: BlueprintInvocationOverride['fields'],
  timing: BlueprintInvocationOverride['timing'] = {
    kind: 'on_trigger',
    offsetDays: null,
    afterStepId: null,
  },
): BlueprintInvocationOverride {
  return { sourceStepId: 'source', kind: 'task', fields, timing };
}
describe('retained private starting overrides', () => {
  it('preserves literal assignments, blank prose and canonical effort without publishing references', () => {
    const result = compileRetainedPreset(
      source,
      preset({
        title: 'Report {monthName} {year}',
        description: '',
        summary: null,
        team_id: '01M4YXWX1D1M7GN65EK40MW9R1',
        assignee_id: null,
        estimate_minutes: null,
        priority: 'high',
      }),
      '2026-10-14',
      new Map(),
    );
    expect(result.fields).toMatchObject({
      title: 'Report October 2026',
      description: '',
      summary: null,
      estimateMinutes: null,
      priority: 'high',
    });
    expect(result.fields).not.toHaveProperty('team_id');
    expect(result.override).toMatchObject({
      path: [],
      responsibleActorId: null,
      documentPrepared: true,
      dates: { startDate: null, dueDate: '2026-10-14' },
    });
  });
  it('keeps trigger-relative signed root dates independent of its creation anchor', () => {
    const result = compileRetainedPreset(
      source,
      preset({ title: 'Report', start_offset_days: -2, due_offset_days: 5 }),
      '2026-10-14',
      new Map(),
    );
    expect(result.override.dates).toEqual({ startDate: '2026-10-12', dueDate: '2026-10-19' });
  });
  it('creates a completion-waiting date as null and resolves it only from checked completion facts', () => {
    const entry = preset(
      { title: 'Follow up' },
      { kind: 'after_step_completion', afterStepId: 'first', offsetDays: 2 },
    );
    expect(
      compileRetainedPreset(source, entry, '2026-10-14', new Map()).override.dates?.dueDate,
    ).toBeNull();
    expect(
      compileRetainedPreset(source, entry, '2026-10-14', new Map([['first', '2026-10-16']]))
        .override.dates?.dueDate,
    ).toBe('2026-10-18');
  });
});
