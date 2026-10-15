import { describe, expect, it } from 'vitest';
import {
  addBlueprintChild,
  removeBlueprintChild,
  moveBlueprintChild,
  orderedBlueprintChildren,
  blueprintStepName,
} from '@/components/templates/work-template-blueprint-edit';

describe('blueprint authored identity and ordering', () => {
  it.each([false, true])(
    'appends after retained siblings when a preceding child was removed (nested: %s)',
    (nested) => {
      let source = nested
        ? addBlueprintChild({ steps: [], dependencies: [] }, 'task', null, 'Parent')
        : { steps: [], dependencies: [] };
      const parent = nested ? (source.steps[0]?.key ?? null) : null;
      for (const name of ['First', 'Second', 'Last']) {
        source = addBlueprintChild(source, 'task', parent, name);
      }
      const first = source.steps.at(-3);
      const last = source.steps.at(-1);
      if (!first || !last) throw new Error('Missing authored siblings');
      source = {
        ...source,
        steps: source.steps.map((step) =>
          step.key === last.key ? { ...step, key: 'z_last' } : step,
        ),
      };
      const retained = removeBlueprintChild(source, first.key);
      const next = addBlueprintChild(retained, 'task', parent, 'Appended');
      const appended = next.steps.at(-1);
      if (!appended) throw new Error('Missing appended sibling');
      const names = (value: typeof next): string[] =>
        orderedBlueprintChildren(value)
          .filter((step) => step.parentStepKey === parent)
          .map(blueprintStepName);
      expect(names(next)).toEqual(['Second', 'Last', 'Appended']);
      expect(next.steps.slice(0, -1)).toEqual(retained.steps);
      const earlier = moveBlueprintChild(next, appended.key, -1);
      expect(names(earlier)).toEqual(['Second', 'Appended', 'Last']);
      expect(names(moveBlueprintChild(earlier, appended.key, 1))).toEqual([
        'Second',
        'Last',
        'Appended',
      ]);
    },
  );
  it('never reuses the logical key of a removed child for newly authored work', () => {
    const first = addBlueprintChild({ steps: [], dependencies: [] }, 'task', null);
    const key = first.steps[0]?.key;
    if (!key) throw new Error('Missing authored child');
    const next = addBlueprintChild(removeBlueprintChild(first, key), 'task', null);
    expect(next.steps[0]?.key).not.toBe(key);
  });
  it('changes sibling order without changing names, keys or nested parent references', () => {
    const first = addBlueprintChild({ steps: [], dependencies: [] }, 'task', null);
    const parent = first.steps[0]?.key;
    if (!parent) throw new Error('Missing authored child');
    const nested = addBlueprintChild(first, 'task', parent);
    const source = addBlueprintChild(nested, 'task', null);
    const last = source.steps[2]?.key;
    if (!last) throw new Error('Missing authored sibling');
    const reordered = moveBlueprintChild(source, last, -1);
    expect(reordered.steps.map((step) => [step.key, step.parentStepKey, step.fields])).toEqual(
      source.steps.map((step) => [step.key, step.parentStepKey, step.fields]),
    );
    expect(
      [...reordered.steps]
        .filter((step) => step.parentStepKey === null)
        .sort((a, b) => a.sort - b.sort)
        .map((step) => step.key),
    ).toEqual([last, parent]);
  });
});

import { blueprintStepTiming } from '@/components/templates/work-template-blueprint-timing';

it('describes Program anchors as creation dates at the root and below a nested Program', () => {
  const root = addBlueprintChild({ steps: [], dependencies: [] }, 'project', null);
  const step = root.steps[0];
  if (!step) throw new Error('Missing project');
  if (step.kind !== 'project') throw new Error('Expected Project');
  step.dates.targetDate = {
    kind: 'anchor',
    anchor: { kind: 'parent' },
    offset: { days: 7, unit: 'calendar' },
  };
  expect(blueprintStepTiming(step, root, 'Community service', 'program')).toBe(
    'Target 7 days after Community service creation date',
  );
  const nested = addBlueprintChild(root, 'program', null, 'Outreach');
  const program = nested.steps[1];
  if (!program) throw new Error('Missing program');
  step.parentStepKey = program.key;
  expect(blueprintStepTiming(step, nested, 'Community service', 'initiative')).toBe(
    'Target 7 days after Outreach creation date',
  );
});
