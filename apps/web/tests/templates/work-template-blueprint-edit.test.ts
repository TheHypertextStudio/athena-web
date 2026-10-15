import { describe, expect, it } from 'vitest';
import {
  addBlueprintChild,
  removeBlueprintChild,
  moveBlueprintChild,
} from '@/components/templates/work-template-blueprint-edit';

describe('blueprint authored identity and ordering', () => {
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
