import { expect, it } from 'vitest';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { compileAuthoredPrivateDefinition } from '../../src/lib/recurrence/private-definition-compiler';
const team = '01K00000000000000000000001',
  workType = '01K00000000000000000000002',
  version = '01K00000000000000000000003';
function fixture() {
  const definition = ProcessDefinitionCreate.parse({
    name: 'Private dinner',
    project: { key: 'dinner', name: 'Dinner {month}', description: 'Private\n\n', teamId: team },
    milestones: [{ key: 'doors', projectKey: 'dinner', name: 'Doors', sort: 3 }],
    tasks: [
      {
        key: 'selected',
        title: 'Email {month}',
        description: '',
        teamId: team,
        workTypeId: workType,
        workTypeVersionId: version,
        projectKey: 'dinner',
        milestoneKey: 'doors',
        timing: { kind: 'after_step_completion', stepKey: 'follow', offsetDays: 1 },
      },
      {
        key: 'follow',
        title: 'Follow',
        teamId: team,
        workTypeId: workType,
        workTypeVersionId: version,
        parentTaskKey: 'selected',
        dueOffsetDays: 4,
      },
    ],
  });
  const aliases = new Map([
    ['dinner', 'alias-project'],
    ['doors', 'alias-doors'],
    ['selected', 'alias-email'],
    ['follow', 'alias-follow'],
  ]);
  const publications = new Map(
    ['alias-project', 'alias-email', 'alias-follow'].map((id) => [
      id,
      { workTypeId: workType, workTypeVersionId: version },
    ]),
  );
  return {
    definitionAlias: 'head-alias',
    revisionAlias: 'revision-alias',
    definition,
    aliases,
    publications,
  };
}
it('compiles pinned private roots, exact nested aliases, qualified containment and original field/title/completion policy', () => {
  const f = fixture(),
    original = JSON.stringify(f.definition),
    document = compileAuthoredPrivateDefinition(f);
  expect(document.kind).toBe('private_definition');
  expect(document.roots).toHaveLength(3);
  expect(document.roots[0]?.stepOverrides[0]).toMatchObject({
    kind: 'milestone',
    path: ['doors'],
    fields: { name: 'Doors' },
  });
  expect(
    document.sourceMappings.map((entry) => [entry.alias, entry.sourceKey, entry.reference]),
  ).toEqual([
    ['alias-project', 'dinner', { rootKey: 'dinner', path: [] }],
    ['alias-doors', 'doors', { rootKey: 'dinner', path: ['doors'] }],
    ['alias-email', 'selected', { rootKey: 'selected', path: [] }],
    ['alias-follow', 'follow', { rootKey: 'follow', path: [] }],
  ]);
  expect(document.placements).toEqual([
    {
      rootKey: 'selected',
      project: { rootKey: 'dinner', path: [] },
      milestone: { rootKey: 'dinner', path: ['doors'] },
    },
    { rootKey: 'follow', parentTask: { rootKey: 'selected', path: [] } },
  ]);
  expect(document.timing.rules).toContainEqual({
    target: { rootKey: 'selected', path: [], field: 'dueDate' },
    source: { kind: 'after_completion', works: [{ rootKey: 'follow', path: [] }] },
    offset: { days: 1, unit: 'calendar' },
  });
  expect(document.completionPolicy.tasks).toEqual([
    { rootKey: 'selected', path: [] },
    { rootKey: 'follow', path: [] },
  ]);
  expect(document.roots[0]?.root?.fields).toMatchObject({ description: 'Private\n\n' });
  expect(document.authoring.definition).toEqual(f.definition);
  expect(JSON.stringify(f.definition)).toBe(original);
  expect(document).not.toHaveProperty('source');
  expect(document).not.toHaveProperty('timezone');
});
it('fails closed for a missing pinned root publication rather than manufacturing a legacy binding', () => {
  const f = fixture();
  f.publications.delete('alias-email');
  expect(() => compileAuthoredPrivateDefinition(f)).toThrow(
    'Private root publication is unavailable.',
  );
});
