import { expect, it } from 'vitest';
import { CanonicalPrivateWorkDefinition } from '@docket/work/work-private-definition';
import { projectPrivateDefinitionRevision } from '../../src/lib/recurrence/private-definition-projection';

const id = '01K00000000000000000000001',
  head = '01K00000000000000000000002',
  alias = '01K00000000000000000000003',
  version = '01K00000000000000000000004';
function fixture() {
  const original = {
    name: 'Private repeat',
    creationMode: 'when_ready',
    tasks: [
      {
        key: 'one',
        title: 'Email {month}',
        description: 'Private\n\n',
        teamId: id,
        dueOffsetDays: 5,
        timing: { kind: 'relative_to_trigger', offsetDays: 2 },
      },
    ],
  };
  // A literal due offset preserves the independently authored timing declaration in exact readback.
  const reference = { rootKey: 'one', path: [] },
    mapping = { alias, sourceKey: 'one', reference, kind: 'task', sort: 0 };
  const document = CanonicalPrivateWorkDefinition.parse({
    kind: 'private_definition',
    revision: 1,
    state: 'published',
    creationMode: 'when_ready',
    roots: [
      {
        key: 'one',
        template: {
          targetType: 'task',
          workTypeId: id,
          selection: { kind: 'pinned', workTypeVersionId: version },
        },
        root: {
          kind: 'task',
          fields: { title: 'Email {month}', description: 'Private\n\n' },
          dates: {},
          teamId: id,
          placement: {},
        },
        stepOverrides: [],
        optionalChoices: [],
      },
    ],
    sourceMappings: [mapping],
    dependencies: [],
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { ...reference, field: 'dueDate' },
          source: { kind: 'run' },
          offset: { days: 5, unit: 'calendar' },
        },
      ],
    },
    absentFields: [{ ...reference, field: 'startDate' }],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [{ target: reference, kind: 'task', pattern: 'Email {month}' }],
    completionPolicy: { kind: 'legacy_authored_tasks', revision: 1, tasks: [reference] },
    authoring: {
      kind: 'process_definition',
      revision: 1,
      definitionAlias: head,
      revisionAlias: id,
      definition: original,
    },
  });
  const revision = {
    id,
    headId: head,
    number: 3,
    state: 'published' as const,
    creationMode: 'when_ready' as const,
    projection: {
      revision: 1 as const,
      steps: [{ alias, key: 'one', rootKey: 'one', path: [], kind: 'task' as const, sort: 0 }],
    },
    createdAt: new Date('2026-10-01T00:00:00Z'),
    publishedAt: new Date('2026-10-02T00:00:00Z'),
  };
  return { original, document, revision };
}
it('projects the exact authored DTO rather than reverse-inferencing original timing from derived dates', () => {
  const f = fixture(),
    revision = projectPrivateDefinitionRevision(f.revision, f.document);
  expect(revision.tasks[0]).toMatchObject({
    title: 'Email {month}',
    description: 'Private\n\n',
    dueOffsetDays: 5,
    timing: { kind: 'relative_to_trigger', offsetDays: 2 },
  });
  expect(revision.number).toBe(3);
  expect(revision.id).toBe(id);
  expect(revision.definitionId).toBe(head);
});
it('rejects a mismatched canonical head/revision or changed compatibility alias before readback', () => {
  const f = fixture();
  expect(() =>
    projectPrivateDefinitionRevision({ ...f.revision, headId: version }, f.document),
  ).toThrow();
  expect(() =>
    projectPrivateDefinitionRevision(
      { ...f.revision, projection: { revision: 1, steps: [] } },
      f.document,
    ),
  ).toThrow();
});

it('retains genuine empty pending input without manufacturing a publication or runnable selection', () => {
  const f = fixture();
  const document = CanonicalPrivateWorkDefinition.parse({
    ...f.document,
    state: 'pending_draft',
    roots: [],
    sourceMappings: [],
    timing: { kind: 'field_timing', revision: 2, rules: [] },
    absentFields: [],
    titles: [],
    completionPolicy: { kind: 'legacy_authored_tasks', revision: 1, tasks: [] },
    authoring: {
      ...f.document.authoring,
      definition: { name: 'Empty private draft', creationMode: 'when_ready', tasks: [] },
    },
  });
  const revision = projectPrivateDefinitionRevision(
    {
      ...f.revision,
      state: 'pending_draft',
      publishedAt: null,
      projection: { revision: 1, steps: [] },
    },
    document,
  );
  expect(revision.tasks).toEqual([]);
  expect(revision.publishedAt).toBeNull();
});
