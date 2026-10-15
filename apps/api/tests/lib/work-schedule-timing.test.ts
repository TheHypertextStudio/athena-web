import { describe, expect, it } from 'vitest';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import {
  compileScheduleCommand,
  planScheduleBlueprint,
} from '../../src/lib/recurrence/schedule-compiler';
import { compileScheduleTiming } from '../../src/lib/recurrence/schedule-timing';
import type { WorkCreationBatchCommand } from '../../src/lib/work-creation/types';
import { actor, input, team, ulid } from './work-schedule-fixture';

function draft(dates: Record<string, string | null> = {}) {
  return WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    timezone: 'UTC',
    root: { kind: 'project', fields: {}, dates, placement: {}, teamId: team },
    stepOverrides: [],
    optionalChoices: [],
  });
}
const ref = (rootKey: string, path: string[] = []) => ({ rootKey, path });
function forest(
  timing: WorkCreationBatchCommand['scheduleTiming'],
  dates: Record<string, string | null> = {},
) {
  const document = WorkScheduleForest.parse({
    kind: 'forest',
    revision: 1,
    state: 'published',
    roots: [
      { key: 'one', draft: draft(dates) },
      { key: 'two', draft: draft() },
    ],
    timing,
    dependencies: [],
  });
  const command = compileScheduleCommand({
    caller: { orgId: ulid(1), actorId: actor, roleId: null, capabilities: ['manage'] },
    seriesId: ulid(3),
    ownerProgramId: null,
    document,
    runDate: '2026-10-08',
  });
  const plans = command.roots.map((root) => ({
    tree: planScheduleBlueprint(root.command, input()).tree,
    replan: (next: typeof root.command) => planScheduleBlueprint(next, input()).tree,
  }));
  return { command, plans };
}
describe('private qualified forest timing', () => {
  it('uses qualified descendant dates and reflows the target root children with the ordinary planner', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('two', ['child']), offsetDays: 1 },
    ]);
    const compiled = compileScheduleTiming(command, plans);
    expect(compiled.roots[0]?.command.body).toMatchObject({ targetDate: '2026-09-18' });
    const root = compiled.roots[0];
    if (!root) throw new Error('Missing checked root');
    const tree = plans[0]?.replan(root.command);
    expect(tree?.nodes[0]?.dates.targetDate).toBe('2026-09-18');
    expect(tree?.nodes[1]?.dates.dueDate).toBe('2026-08-28');
    expect(compiled.roots).toHaveLength(2);
  });
  it('preserves explicit null and hand-set root dates over private derived timing', () => {
    for (const targetDate of [null, '2026-10-10']) {
      const { command, plans } = forest(
        [{ target: ref('one'), prerequisite: ref('two'), offsetDays: -7 }],
        { targetDate },
      );
      const compiled = compileScheduleTiming(command, plans);
      const root = compiled.roots[0];
      if (!root) throw new Error('Missing checked root');
      expect(plans[0]?.replan(root.command).nodes[0]?.dates.targetDate).toBe(targetDate);
    }
  });
  it('rejects a private timing cycle through implicit parent date rules', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('one', ['child']), offsetDays: 1 },
    ]);
    expect(() => compileScheduleTiming(command, plans)).toThrow('cannot form a cycle');
  });
  it('rejects missing or unselected paths and ambiguous multiple anchors', () => {
    for (const timing of [
      [{ target: ref('one', ['missing']), prerequisite: ref('two'), offsetDays: 0 }],
      [
        { target: ref('one'), prerequisite: ref('two'), offsetDays: 0 },
        { target: ref('one'), prerequisite: ref('two', ['child']), offsetDays: 0 },
      ],
    ]) {
      const { command, plans } = forest(timing);
      expect(() => compileScheduleTiming(command, plans)).toThrow();
    }
  });
});
