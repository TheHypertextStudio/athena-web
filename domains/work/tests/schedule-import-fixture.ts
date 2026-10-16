import { LegacyScheduleImportInput } from '../src/contracts/work-schedule-import';
/** Checked source fixture supplies original aliases separately from its full logical selected closure. */
export function legacyImportFixture(): LegacyScheduleImportInput {
  const sourceMappings = [
    {
      alias: 'old-task',
      sourceKey: '0legacy-source',
      reference: { rootKey: 'source', path: [] },
      kind: 'task',
      sort: 0,
    },
    {
      alias: 'old-project',
      sourceKey: 'old-event',
      reference: { rootKey: 'event', path: [] },
      kind: 'project',
      sort: 4,
    },
    {
      alias: 'old-follow',
      sourceKey: 'follow',
      reference: { rootKey: 'event', path: ['follow'] },
      kind: 'task',
      sort: 6,
    },
  ];
  return LegacyScheduleImportInput.parse({
    source: {
      kind: 'retained_source',
      revision: 1,
      revisionAlias: 'old-revision',
      invocationId: 'old-invocation',
      originalFingerprint: 'a'.repeat(32),
      archiveHash: 'sha256:' + 'b'.repeat(64),
    },
    sourceBody: { privateMarkdown: '![Private](library-file:old)\n\n', nullableAssignment: null },
    state: 'published',
    creationMode: 'when_ready',
    roots: importRoots(),
    steps: [
      {
        key: '0legacy-source',
        kind: 'task',
        timing: { kind: 'on_trigger' },
        fieldOverrides: { title: 'Email {month}', description: 'Original' },
      },
      {
        key: 'old-event',
        kind: 'project',
        timing: { kind: 'after_step_completion', stepKey: '0legacy-source', offsetDays: 2 },
        fieldOverrides: { name: 'Dinner {monthName}', description: null },
      },
      {
        key: 'follow',
        kind: 'task',
        timing: { kind: 'after_step_completion', stepKey: '0legacy-source', offsetDays: 4 },
        fieldOverrides: { title: 'Follow {date}', description: '' },
      },
    ],
    sourceMappings,
    selectedWork: [
      ...sourceMappings.map(({ reference, kind }) => ({ reference, kind })),
      { reference: { rootKey: 'event', path: ['template-only'] }, kind: 'task' },
    ],
  });
}

function importRoots() {
  return [
    {
      key: 'event',
      template: {
        targetType: 'project',
        workTypeId: '01K00000000000000000000001',
        selection: { kind: 'pinned', workTypeVersionId: '01K00000000000000000000002' },
      },
      root: {
        kind: 'project',
        fields: { name: 'Dinner {monthName}', description: '' },
        dates: {},
        placement: {},
        responsibleActorId: null,
      },
      stepOverrides: [
        { kind: 'task', path: ['follow'], fields: { title: 'Follow {date}', description: '' } },
      ],
      optionalChoices: [],
    },
    {
      key: 'source',
      template: {
        targetType: 'task',
        workTypeId: '01K00000000000000000000003',
        selection: { kind: 'pinned', workTypeVersionId: '01K00000000000000000000004' },
      },
      root: {
        kind: 'task',
        fields: { title: 'Email {month}', description: 'Original' },
        dates: {},
        placement: {},
      },
      stepOverrides: [],
      optionalChoices: [],
    },
  ];
}
