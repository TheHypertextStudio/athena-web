import { describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import {
  validateProspectiveBlueprintDefinition,
  type ProspectiveBlueprintSnapshot,
} from '../src/blueprints/prospective';
import { publication, step } from './blueprint-fixtures';

function source(
  key: string,
  kind: ProspectiveBlueprintSnapshot['kind'],
  steps: ReturnType<typeof step>[] = [],
): ProspectiveBlueprintSnapshot {
  return {
    sourceKey: key,
    definitionKey: key.split('@')[0] ?? key,
    scopeKey: 'catalog:1',
    kind,
    definition: WorkTemplateDefinition.parse({
      name: key,
      payload: { targetType: kind },
      blueprint: { steps, dependencies: [] },
    }),
  };
}
const ref = (kind = 'task') => {
  const value = publication(9, kind === 'project' ? 'project' : 'task');
  return {
    workTypeId: value.workTypeId,
    selection: { kind: 'pinned' as const, workTypeVersionId: value.versionId },
  };
};

describe('prospective definitions without publication authority', () => {
  it('validates an unpublished outline with inline work and no publication or projection IDs', () => {
    const root = source('draft:primitive@0', 'project', [
      step('checkpoint', 'milestone'),
      step('prepare', 'task', { parentStepKey: 'checkpoint' }),
    ]);
    const graph = validateProspectiveBlueprintDefinition({ root, sources: [], bindings: [] });
    expect(graph.nodes.map((node) => node.path)).toEqual([[], ['checkpoint'], ['prepare']]);
    expect(graph.nodes[2]).toMatchObject({
      ownerSourceKey: root.sourceKey,
      selectedSourceKey: null,
      sourceStepKey: 'prepare',
    });
    expect(graph.nodes[2]).not.toHaveProperty('sourceStepId');
    expect(graph.nodes[2]).not.toHaveProperty('workTypeVersionId');
  });
  it('qualifies repeated exact references through the same authored slot facts', () => {
    const child = source('catalog:child@1', 'task', [step('confirm')]);
    const root = source(
      'catalog:root@1',
      'project',
      ['a', 'b'].map((key) => step(key, 'task', { template: ref() })),
    );
    const result = validateProspectiveBlueprintDefinition({
      root,
      sources: [child],
      bindings: ['a', 'b'].map((stepKey) => ({
        ownerSourceKey: root.sourceKey,
        stepKey,
        targetSourceKey: child.sourceKey,
      })),
    });
    expect(result.nodes.map((node) => node.path)).toEqual([
      [],
      ['a'],
      ['a', 'confirm'],
      ['b'],
      ['b', 'confirm'],
    ]);
  });
  it('rejects missing, foreign-scope, kind-mismatched and conflicting resolved facts', () => {
    const child = source('catalog:child@1', 'task');
    const root = source('catalog:root@1', 'project', [step('child', 'task', { template: ref() })]);
    const binding = {
      ownerSourceKey: root.sourceKey,
      stepKey: 'child',
      targetSourceKey: child.sourceKey,
    };
    expect(() =>
      validateProspectiveBlueprintDefinition({ root, sources: [child], bindings: [] }),
    ).toThrow(/resolution/i);
    for (const invalid of [
      { ...child, scopeKey: 'tenant:other' },
      source(child.sourceKey, 'project'),
    ])
      expect(() =>
        validateProspectiveBlueprintDefinition({ root, sources: [invalid], bindings: [binding] }),
      ).toThrow(/scope|kind/i);
    expect(() =>
      validateProspectiveBlueprintDefinition({
        root,
        sources: [child, { ...child, definition: { ...child.definition, name: 'Contradictory' } }],
        bindings: [binding],
      }),
    ).toThrow(/conflict/i);
  });
  it('rejects regeneration through another revision of the same definition', () => {
    const old = source('catalog:root@1', 'task');
    const root = source('catalog:root@2', 'task', [step('again', 'task', { template: ref() })]);
    expect(() =>
      validateProspectiveBlueprintDefinition({
        root,
        sources: [old],
        bindings: [
          { ownerSourceKey: root.sourceKey, stepKey: 'again', targetSourceKey: old.sourceKey },
        ],
      }),
    ).toThrow(/loop/i);
  });
  it('uses the ordinary hierarchy and timing prerequisite rules', () => {
    expect(() =>
      validateProspectiveBlueprintDefinition({
        root: source('bad', 'program', [step('checkpoint', 'milestone')]),
        sources: [],
        bindings: [],
      }),
    ).toThrow(/hierarchy/i);
    const dates = (key: string) => ({
      dueDate: { kind: 'after_completion', stepKeys: [key], offset: { days: 0, unit: 'calendar' } },
    });
    expect(() =>
      validateProspectiveBlueprintDefinition({
        root: source('loop', 'project', [
          step('a', 'task', { dates: dates('b') }),
          step('b', 'task', { dates: dates('a') }),
        ]),
        sources: [],
        bindings: [],
      }),
    ).toThrow(/cycle/i);
  });
  it('counts the root, checkpoints and optional work at the exact 500 boundary', () => {
    const steps = Array.from({ length: 499 }, (_, i) => step(`m${i}`, 'milestone'));
    expect(
      validateProspectiveBlueprintDefinition({
        root: source('limit', 'project', steps),
        sources: [],
        bindings: [],
      }).nodes,
    ).toHaveLength(500);
    const nested = source('nested', 'task', [step('extra')]);
    steps[0] = step('optional', 'task', {
      template: ref(),
      optional: { enabled: true, selectedByDefault: false },
    });
    const root = source('limit', 'project', steps);
    expect(() =>
      validateProspectiveBlueprintDefinition({
        root,
        sources: [nested],
        bindings: [
          {
            ownerSourceKey: root.sourceKey,
            stepKey: 'optional',
            targetSourceKey: nested.sourceKey,
          },
        ],
      }),
    ).toThrow(/500/i);
  });
});

it('compares duplicate logical sources independently of object field order', () => {
  const root = source('root', 'task');
  const reordered = {
    definition: root.definition,
    kind: root.kind,
    scopeKey: root.scopeKey,
    definitionKey: root.definitionKey,
    sourceKey: root.sourceKey,
  };
  expect(
    validateProspectiveBlueprintDefinition({ root, sources: [reordered], bindings: [] }).nodes,
  ).toHaveLength(1);
});
