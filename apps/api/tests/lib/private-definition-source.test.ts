import { expect, it } from 'vitest';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { compilePrivateDefinitionSources } from '../../src/lib/recurrence/private-definition-source';

const team = '01K00000000000000000000001',
  selected = '01K00000000000000000000002',
  version = '01K00000000000000000000003';
it('compiles exact private DTO aliases and split selected roots without normalized source writes', () => {
  const definition = ProcessDefinitionCreate.parse({
    name: 'Private dinner',
    project: { key: 'dinner', name: 'Dinner {monthName}', description: 'Private\n\n' },
    tasks: [
      {
        key: '0selected-email',
        title: 'Email {date}',
        teamId: team,
        projectKey: 'dinner',
        workTypeId: selected,
        workTypeVersionId: version,
      },
      {
        key: 'follow',
        title: 'Follow',
        teamId: team,
        parentTaskKey: '0selected-email',
        description: '',
      },
    ],
  });
  const aliases = new Map([
    ['dinner', 'alias-project'],
    ['0selected-email', 'alias-email'],
    ['follow', 'alias-follow'],
  ]);
  const before = JSON.stringify(definition),
    sources = compilePrivateDefinitionSources(definition, aliases);
  expect(
    sources.map((source) => [source.id, source.sourceKey, source.rootId, source.parentId]),
  ).toEqual([
    ['alias-project', 'dinner', 'alias-project', null],
    ['alias-email', '0selected-email', 'alias-email', 'alias-project'],
    ['alias-follow', 'follow', 'alias-follow', 'alias-email'],
  ]);
  expect(sources[1]?.key).toMatch(/^legacy_[a-f0-9]{48}$/);
  expect(sources[1]?.preset.fields).toMatchObject({
    work_type_id: selected,
    work_type_version_id: version,
    project_step_id: 'alias-project',
  });
  expect(sources[2]?.preset.fields).toMatchObject({
    parent_task_step_id: 'alias-email',
    description: '',
  });
  expect(JSON.stringify(definition)).toBe(before);
});
it('refuses missing server-allocated compatibility aliases before any publication', () => {
  const definition = ProcessDefinitionCreate.parse({
    name: 'Private repeat',
    tasks: [{ key: 'one', title: 'Task', teamId: team }],
  });
  expect(() => compilePrivateDefinitionSources(definition, new Map())).toThrow(
    'Private authoring aliases are incomplete.',
  );
});
