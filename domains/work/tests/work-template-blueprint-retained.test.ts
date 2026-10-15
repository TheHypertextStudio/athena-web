import { describe, expect, it } from 'vitest';
import { CycleId } from '../src/ids';
import { planBlueprint } from '../src/blueprints/rules';
import {
  present,
  existing,
  actor,
  context,
  input,
  publication,
  step,
  graph,
  resolution,
  ulid,
} from './blueprint-fixtures';
describe('checked existing blueprint planner facts', () => {
  it('adopts exact existing facts without revalidating its inactive assignment, closed cycle or manual date', () => {
    const saved = present(existing()[1]);
    const closed = CycleId.parse(ulid(70));
    const actual = {
      ...saved,
      fields: { title: 'Manually edited', summary: null },
      responsibleActorId: actor,
      cycleId: closed,
      dates: { startDate: null, dueDate: null },
      everStarted: true,
    };
    const planned = planBlueprint(
      input({
        context: context({
          actors: [{ id: actor, active: false }],
          existingNodes: [actual],
          cycles: [],
        }),
      }),
    );
    expect(planned.nodes[1]).toMatchObject({
      fields: { title: 'Manually edited', summary: null },
      responsibleActorId: actor,
      cycleId: closed,
      dates: { startDate: null, dueDate: null },
    });
  });
  it('keeps live checks on new descendants of an adopted inactive assignee and closed cycle', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'project', [
      step('child'),
      step('grand', 'task', {
        parentStepKey: 'child',
        actorRule: 'parent_responsible',
        cycleRule: 'parent_cycle',
      }),
    ]);
    const saved = {
      ...present(existing()[1]),
      responsibleActorId: actor,
      cycleId: CycleId.parse(ulid(70)),
    };
    const planned = planBlueprint(
      input({
        graph: graph(root, [base], [resolution(['child'], base), resolution(['grand'], base)]),
        context: context({ actors: [{ id: actor, active: false }], existingNodes: [saved] }),
      }),
    );
    expect(planned.nodes[1]?.responsibleActorId).toBe(actor);
    expect(planned.nodes[2]).toMatchObject({ responsibleActorId: null, cycleId: null });
  });
  it('refuses a retained snapshot whose kind does not match the exact selected path', () => {
    const wrong = { ...present(existing()[1]), kind: 'project' as const };
    expect(() => planBlueprint(input({ context: context({ existingNodes: [wrong] }) }))).toThrow(
      /existing|retained|kind/i,
    );
  });
});
