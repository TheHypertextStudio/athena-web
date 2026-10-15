import { describe, expect, it } from 'vitest';
import { WorkScheduleDraft } from '../src/contracts/work-schedule';
const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
function dinner() {
  return {
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: id, selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    timezone: 'America/Los_Angeles',
    root: {
      kind: 'project',
      fields: { priority: 'high', health: null, description: '' },
      placement: { programId: id },
      teamId: id,
      responsibleActorId: null,
      dates: { targetDate: '2026-10-08' },
    },
    stepOverrides: [
      {
        path: ['book_venue'],
        kind: 'task',
        responsibleActorId: id,
        teamId: id,
        cycleId: null,
        fields: { summary: '', estimateMinutes: null },
        dates: { dueDate: null },
      },
    ],
    optionalChoices: [{ path: ['decorations'], selected: false }],
  };
}
describe('private native schedule draft', () => {
  it('roundtrips real destination, assignments, null clears and authored blank prose', () => {
    expect(WorkScheduleDraft.parse(dinner())).toEqual(dinner());
  });
  it('preserves absent fields and accepts pinned standalone Task destinations', () => {
    const input = {
      ...dinner(),
      template: {
        targetType: 'task',
        workTypeId: id,
        selection: { kind: 'pinned', workTypeVersionId: id },
      },
      root: {
        kind: 'task',
        fields: {},
        placement: { projectId: id, milestoneId: id, parentTaskId: id },
        dates: {},
      },
      stepOverrides: [],
      optionalChoices: [],
    };
    expect(WorkScheduleDraft.parse(input)).toEqual(input);
  });
  it('rejects template/root kind mismatch and invalid saved timezone', () => {
    expect(
      WorkScheduleDraft.safeParse({
        ...dinner(),
        root: { kind: 'task', fields: {}, dates: {}, placement: {} },
      }).success,
    ).toBe(false);
    expect(WorkScheduleDraft.safeParse({ ...dinner(), timezone: 'not/a-zone' }).success).toBe(
      false,
    );
  });
  it('rejects duplicate child overrides and optional choices', () => {
    expect(
      WorkScheduleDraft.safeParse({
        ...dinner(),
        stepOverrides: [...dinner().stepOverrides, ...dinner().stepOverrides],
      }).success,
    ).toBe(false);
    expect(
      WorkScheduleDraft.safeParse({
        ...dinner(),
        optionalChoices: [...dinner().optionalChoices, ...dinner().optionalChoices],
      }).success,
    ).toBe(false);
  });
  it('refuses identity, provenance, structure and separate cadence authority', () => {
    for (const field of [
      'workTypeId',
      'workTypeVersionId',
      'blueprintStepId',
      'blueprint',
      'children',
    ]) {
      const override = { ...dinner().stepOverrides[0], [field]: id };
      expect(WorkScheduleDraft.safeParse({ ...dinner(), stepOverrides: [override] }).success).toBe(
        false,
      );
    }
    expect(WorkScheduleDraft.safeParse({ ...dinner(), cadence: { kind: 'daily' } }).success).toBe(
      false,
    );
  });
  it('rejects incompatible fields, root destinations and backwards windows', () => {
    for (const root of [
      { ...dinner().root, placement: { parentTaskId: id } },
      { ...dinner().root, fields: { state: 'backlog' } },
      { ...dinner().root, dates: { dueDate: '2026-10-08' } },
      { ...dinner().root, dates: { startDate: '2026-10-09', targetDate: '2026-10-08' } },
    ])
      expect(WorkScheduleDraft.safeParse({ ...dinner(), root }).success).toBe(false);
    expect(
      WorkScheduleDraft.safeParse({
        ...dinner(),
        stepOverrides: [{ path: ['prep'], kind: 'project', cycleId: id }],
      }).success,
    ).toBe(false);
  });
  it('retains independent copies without importing literals into reusable defaults', () => {
    const a = WorkScheduleDraft.parse(dinner()),
      b = WorkScheduleDraft.parse(dinner());
    a.root.fields.description = 'Private venue details';
    expect(b.root.fields.description).toBe('');
  });
});
