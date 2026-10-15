import { describe, expect, it } from 'vitest';
import {
  Blueprint,
  BlueprintStep,
  BlueprintDateRule,
} from '../src/contracts/work-template-blueprint';
import { WorkTemplateDefinition } from '../src/contracts/work-template';

export const taskStep = (key = 'task') => ({
  key,
  kind: 'task',
  parentStepKey: null,
  sort: 0,
  optional: { enabled: false, selectedByDefault: true },
  template: null,
  fields: { title: 'Authored task' },
  teamRule: 'parent_team',
  actorRule: 'unassigned',
  cycleRule: 'none',
  dates: {},
});

describe('strict reusable blueprint contract', () => {
  it('keeps concrete nullable clears out of authored reusable fields', () => {
    for (const targetType of ['task', 'project', 'program', 'initiative'] as const) {
      expect(
        WorkTemplateDefinition.safeParse({
          name: 'Clear',
          payload: { targetType, summary: null },
        }).success,
      ).toBe(false);
    }
    expect(
      WorkTemplateDefinition.safeParse({
        name: 'Clear',
        payload: { targetType: 'project', health: null },
      }).success,
    ).toBe(false);
    expect(
      BlueprintStep.safeParse({
        ...taskStep(),
        fields: { title: 'Task', summary: null },
      }).success,
    ).toBe(false);
  });
  it('rejects literal placement, actor, team, dates and unknown fields', () => {
    for (const field of ['actorId', 'teamId', 'projectId', 'dueDate', 'unknown']) {
      expect(BlueprintStep.safeParse({ ...taskStep(), [field]: 'literal' }).success).toBe(false);
      expect(
        BlueprintStep.safeParse({ ...taskStep(), fields: { title: 'Task', [field]: 'literal' } })
          .success,
      ).toBe(false);
    }
    expect(BlueprintStep.safeParse({ ...taskStep(), fields: { title: ' ' } }).success).toBe(false);
    expect(
      BlueprintStep.safeParse({ ...taskStep(), fields: { title: 'Task', estimate: -1 } }).success,
    ).toBe(false);
  });
  it('rejects unsupported per-kind rules and nonoptional unchecked defaults', () => {
    expect(
      BlueprintStep.safeParse({ ...taskStep(), kind: 'program', fields: { name: 'Program' } })
        .success,
    ).toBe(false);
    expect(
      BlueprintStep.safeParse({
        ...taskStep(),
        optional: { enabled: false, selectedByDefault: false },
      }).success,
    ).toBe(false);
    expect(Blueprint.safeParse({ steps: [taskStep(), taskStep()], dependencies: [] }).success).toBe(
      false,
    );
  });
  it('requires nonnegative completion offsets and distinct sibling keys', () => {
    const rule = {
      kind: 'after_completion',
      stepKeys: ['one'],
      offset: { days: 0, unit: 'working' },
    };
    expect(BlueprintDateRule.parse(rule)).toEqual(rule);
    expect(BlueprintDateRule.safeParse({ ...rule, stepKeys: ['one', 'one'] }).success).toBe(false);
    expect(
      BlueprintDateRule.safeParse({ ...rule, offset: { days: -1, unit: 'calendar' } }).success,
    ).toBe(false);
  });
  it('parses old definitions without rewriting historical snapshots', () => {
    const original = {
      name: 'Old',
      payload: { targetType: 'task', description: '## Exact heading' },
    };
    const json = JSON.stringify(original);
    expect(WorkTemplateDefinition.parse(original).blueprint).toEqual({
      steps: [],
      dependencies: [],
    });
    expect(JSON.stringify(original)).toBe(json);
  });
});

it('uses the same strict supported starting-field validators in definitions and steps', () => {
  expect(
    WorkTemplateDefinition.safeParse({
      name: 'Bad',
      payload: { targetType: 'task', teamId: 'literal' },
    }).success,
  ).toBe(false);
  expect(
    WorkTemplateDefinition.safeParse({ name: 'Bad', payload: { targetType: 'task', estimate: -1 } })
      .success,
  ).toBe(false);
  expect(
    WorkTemplateDefinition.parse({
      name: 'Effort',
      payload: { targetType: 'task', estimate: 0, estimateMinutes: 0, state: 'backlog' },
    }).payload,
  ).toMatchObject({ estimate: 0, estimateMinutes: 0, state: 'backlog' });
});

it('preserves legacy explicitly blank starting titles without rewriting snapshots', () => {
  for (const targetType of ['task', 'project', 'program'] as const) {
    const payload = targetType === 'task' ? { targetType, title: '' } : { targetType, name: '' };
    const snapshot = { name: 'Blank', payload };
    const before = JSON.stringify(snapshot);
    expect(WorkTemplateDefinition.parse(snapshot).payload).toEqual(payload);
    expect(JSON.stringify(snapshot)).toBe(before);
  }
});
