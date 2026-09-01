import { describe, expect, it } from 'vitest';

import {
  ObjectCommandIn,
  ObjectCommandReplayAccessIn,
  ObjectCommandReplayAccessResult,
  ObjectCommandReplayIn,
  ProjectLeadActorId,
} from '../../../src/contracts/object-command';

const taskIds = ['01ARZ3NDEKTSV4RRFFQ69G5FAV'];

describe('ObjectCommandIn', () => {
  it('accepts an approved Task property replacement', () => {
    expect(
      ObjectCommandIn.parse({
        commandId: 'command_1',
        objectKind: 'task',
        objectIds: taskIds,
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      }),
    ).toMatchObject({ objectKind: 'task' });
  });

  it('accepts non-empty Task titles and rejects empty titles', () => {
    const base = {
      commandId: 'rename-task',
      objectKind: 'task',
      objectIds: taskIds,
    } as const;
    const longTitle = 'x'.repeat(201);

    for (const title of ['Publish the launch', longTitle]) {
      expect(
        ObjectCommandIn.safeParse({
          ...base,
          operation: { type: 'replace_property', property: 'title', value: title },
        }).success,
      ).toBe(true);
    }
    expect(
      ObjectCommandIn.safeParse({
        ...base,
        operation: { type: 'replace_property', property: 'title', value: '' },
      }).success,
    ).toBe(false);
  });

  it('requires a Task title replacement to target exactly one Task', () => {
    expect(
      ObjectCommandIn.safeParse({
        commandId: 'rename-task',
        objectKind: 'task',
        objectIds: [...taskIds, '01ARZ3NDEKTSV4RRFFQ69G5FAW'],
        operation: {
          type: 'replace_property',
          property: 'title',
          value: 'One title cannot rename two Tasks',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported text and Project-only properties on Tasks', () => {
    for (const operation of [
      { type: 'replace_property', property: 'description', value: 'Destroyed' },
      { type: 'replace_property', property: 'health', value: 'on_track' },
    ]) {
      expect(
        ObjectCommandIn.safeParse({
          commandId: 'command_1',
          objectKind: 'task',
          objectIds: taskIds,
          operation,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects duplicate ids and more than 500 objects', () => {
    const base = {
      commandId: 'command_1',
      objectKind: 'task',
      operation: { type: 'trash' },
    } as const;
    expect(
      ObjectCommandIn.safeParse({ ...base, objectIds: [...taskIds, ...taskIds] }).success,
    ).toBe(false);
    expect(
      ObjectCommandIn.safeParse({
        ...base,
        objectIds: Array.from({ length: 501 }, () => taskIds[0]),
      }).success,
    ).toBe(false);
  });

  it('models Project timeframes as composite values and rejects duplicate associations', () => {
    const projectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(
      ObjectCommandIn.parse({
        commandId: 'timeframe',
        objectKind: 'project',
        objectIds: [projectId],
        operation: {
          type: 'replace_property',
          property: 'startTimeframe',
          value: { date: '2026-04-01', resolution: 'quarter' },
        },
      }).operation,
    ).toMatchObject({ property: 'startTimeframe' });
    expect(
      ObjectCommandIn.safeParse({
        commandId: 'labels',
        objectKind: 'project',
        objectIds: [projectId],
        operation: {
          type: 'add_association',
          association: 'label',
          associationIds: [projectId, projectId],
        },
      }).success,
    ).toBe(false);
    const associationIds = Array.from(
      { length: 21 },
      (_, index) => `${projectId.slice(0, 22)}${String(index).padStart(4, '0')}`,
    );
    const associationCommand = {
      commandId: 'too-many-labels',
      objectKind: 'project',
      objectIds: [projectId],
      operation: {
        type: 'add_association',
        association: 'label',
        associationIds,
      },
    } as const;
    expect(
      ObjectCommandIn.safeParse({
        ...associationCommand,
        operation: {
          ...associationCommand.operation,
          associationIds: associationIds.slice(0, 20),
        },
      }).success,
    ).toBe(true);
    expect(ObjectCommandIn.safeParse(associationCommand).success).toBe(false);
  });

  it('documents Project lead ids as transport Actor ids with server-enforced human semantics', () => {
    const actorId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(ProjectLeadActorId.parse(actorId)).toBe(actorId);
    expect(ProjectLeadActorId.description).toContain('active human');
  });

  it('rejects duplicate Project initiative associations', () => {
    const projectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const initiativeId = '01BRZ3NDEKTSV4RRFFQ69G5FAV';

    expect(
      ObjectCommandIn.safeParse({
        commandId: 'duplicate-initiatives',
        objectKind: 'project',
        objectIds: [projectId],
        operation: {
          type: 'add_association',
          association: 'initiative',
          associationIds: [initiativeId, initiativeId],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects Task dates outside the supported calendar range', () => {
    for (const value of ['1969-12-31', '2201-01-01']) {
      expect(
        ObjectCommandIn.safeParse({
          commandId: 'dated-task',
          objectKind: 'task',
          objectIds: taskIds,
          operation: { type: 'replace_property', property: 'startDate', value },
        }).success,
      ).toBe(false);
    }
    expect(
      ObjectCommandIn.safeParse({
        commandId: 'dated-project',
        objectKind: 'project',
        objectIds: taskIds,
        operation: {
          type: 'replace_property',
          property: 'targetTimeframe',
          value: { date: '2201-01-01', resolution: null },
        },
      }).success,
    ).toBe(false);
  });
});

describe('ObjectCommandReplayIn', () => {
  it('rejects unbounded client-carried receipt strings', () => {
    expect(
      ObjectCommandReplayIn.safeParse({
        commandId: 'bounded-receipt',
        direction: 'undo',
        receipt: {
          commandId: 'original-command',
          objectKind: 'task',
          action: 'replace_property',
          entries: [
            {
              kind: 'object',
              objectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
              property: 'state',
              before: 'backlog',
              after: 'x'.repeat(201),
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a normalized receipt and replay direction', () => {
    expect(
      ObjectCommandReplayIn.parse({
        commandId: 'replay_1',
        direction: 'undo',
        receipt: {
          commandId: 'command_1',
          objectKind: 'task',
          action: 'replace_property',
          entries: [
            {
              kind: 'object',
              objectId: 'task_1',
              property: 'priority',
              before: 'none',
              after: 'high',
            },
          ],
        },
      }).direction,
    ).toBe('undo');
  });

  it('accepts replay of a Task title receipt without narrowing the Task title contract', () => {
    const longTitle = 'x'.repeat(201);
    expect(
      ObjectCommandReplayIn.safeParse({
        commandId: 'replay-title',
        direction: 'undo',
        receipt: {
          commandId: 'rename-task',
          objectKind: 'task',
          action: 'replace_property',
          entries: [
            {
              kind: 'object',
              objectId: taskIds[0],
              property: 'title',
              before: 'Draft the launch note',
              after: longTitle,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate receipt entries and receipts spanning more than 500 objects', () => {
    const entry = (objectId: string) => ({
      kind: 'object' as const,
      objectId,
      property: 'priority',
      before: 'none',
      after: 'high',
    });
    const base = {
      commandId: 'replay_1',
      direction: 'undo',
      receipt: {
        commandId: 'command_1',
        objectKind: 'task',
        action: 'replace_property',
      },
    } as const;
    expect(
      ObjectCommandReplayIn.safeParse({
        ...base,
        receipt: { ...base.receipt, entries: [entry('task_1'), entry('task_1')] },
      }).success,
    ).toBe(false);
    expect(
      ObjectCommandReplayIn.safeParse({
        ...base,
        receipt: {
          ...base.receipt,
          entries: Array.from({ length: 501 }, (_, index) => entry(`task_${index}`)),
        },
      }).success,
    ).toBe(false);
    expect(
      ObjectCommandReplayIn.safeParse({
        ...base,
        receipt: {
          ...base.receipt,
          objectKind: 'project',
          action: 'add_dependency',
          entries: Array.from({ length: 500 }, (_, index) => ({
            kind: 'relation',
            objectId: 'project_0',
            relation: 'dependency',
            relatedId: `project_${index + 1}`,
            before: false,
            after: true,
          })),
        },
      }).success,
    ).toBe(false);
  });

  it('accepts the largest valid association receipt shape', () => {
    const entries = Array.from({ length: 500 }, (_, objectIndex) =>
      Array.from({ length: 20 }, (_, associationIndex) => ({
        kind: 'relation' as const,
        objectId: `project_${objectIndex}`,
        relation: 'label' as const,
        relatedId: `label_${associationIndex}`,
        before: false,
        after: true,
      })),
    ).flat();
    expect(
      ObjectCommandReplayIn.safeParse({
        commandId: 'max-replay',
        direction: 'undo',
        receipt: {
          commandId: 'max-forward',
          objectKind: 'project',
          action: 'add_association',
          entries,
        },
      }).success,
    ).toBe(true);
  });

  it('bounds generated association changes and receipt size', () => {
    const ids = (prefix: string, length: number) =>
      Array.from(
        { length },
        (_, index) => `${prefix.slice(0, 22)}${String(index).padStart(4, '0')}`,
      );
    const objectIds = ids('01ARZ3NDEKTSV4RRFFQ69G5FAV', 500);
    const associationIds = ids('01BRZ3NDEKTSV4RRFFQ69G5FAV', 11);
    const command = {
      commandId: 'bounded-relations',
      objectKind: 'project',
      objectIds,
      operation: {
        type: 'add_association',
        association: 'initiative',
        associationIds: associationIds.slice(0, 10),
      },
    } as const;
    expect(ObjectCommandIn.safeParse(command).success).toBe(true);
    expect(
      ObjectCommandIn.safeParse({
        ...command,
        operation: { ...command.operation, associationIds },
      }).success,
    ).toBe(false);

    const entry = (index: number) => ({
      kind: 'relation' as const,
      objectId: `project_${Math.floor(index / 20)}`,
      relation: 'label' as const,
      relatedId: `label_${index}`,
      before: false,
      after: true,
    });
    const replay = (length: number) => ({
      commandId: 'bounded-replay',
      direction: 'undo' as const,
      receipt: {
        commandId: 'bounded-forward',
        objectKind: 'project' as const,
        action: 'add_association' as const,
        entries: Array.from({ length }, (_, index) => entry(index)),
      },
    });
    expect(ObjectCommandReplayIn.safeParse(replay(10_000)).success).toBe(true);
    expect(ObjectCommandReplayIn.safeParse(replay(10_001)).success).toBe(false);
  });

  it('rejects forged receipt values before replay reaches the database', () => {
    const cases = [
      { objectKind: 'task', property: 'priority', before: 'none', after: 42 },
      { objectKind: 'task', property: 'startDate', before: null, after: '1969-12-31' },
      { objectKind: 'task', property: 'assigneeId', before: null, after: 'not-an-id' },
      { objectKind: 'project', property: 'health', before: null, after: 'broken' },
      { objectKind: 'project', property: 'status', before: 'planned', after: '' },
    ] as const;
    for (const candidate of cases) {
      expect(
        ObjectCommandReplayIn.safeParse({
          commandId: `forged-${candidate.property}`,
          direction: 'undo',
          receipt: {
            commandId: 'forged-forward',
            objectKind: candidate.objectKind,
            action: 'replace_property',
            entries: [
              {
                kind: 'object',
                objectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
                property: candidate.property,
                before: candidate.before,
                after: candidate.after,
              },
            ],
          },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects receipt properties owned by a different object kind', () => {
    for (const candidate of [
      { objectKind: 'task', property: 'health', before: null, after: 'on_track' },
      { objectKind: 'project', property: 'state', before: 'backlog', after: 'done' },
    ] as const) {
      expect(
        ObjectCommandReplayIn.safeParse({
          commandId: `wrong-kind-${candidate.property}`,
          direction: 'undo',
          receipt: {
            commandId: 'wrong-kind-forward',
            objectKind: candidate.objectKind,
            action: 'replace_property',
            entries: [
              {
                kind: 'object',
                objectId: taskIds[0],
                property: candidate.property,
                before: candidate.before,
                after: candidate.after,
              },
            ],
          },
        }).success,
      ).toBe(false);
    }
  });

  it('requires complete canonical status tuples without duplicate properties', () => {
    const objectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const taskEntries = [
      { property: 'state', before: 'backlog', after: 'done' },
      {
        property: 'statusId',
        before: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
        after: '01ARZ3NDEKTSV4RRFFQ69G5FAC',
      },
      { property: 'completedAt', before: null, after: '2026-08-23T12:00:00.000Z' },
      { property: 'canceledAt', before: null, after: null },
    ].map((entry) => ({ kind: 'object' as const, objectId, ...entry }));
    const projectEntries = [
      { property: 'status', before: 'planned', after: 'active' },
      {
        property: 'statusId',
        before: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
        after: '01ARZ3NDEKTSV4RRFFQ69G5FAC',
      },
    ].map((entry) => ({ kind: 'object' as const, objectId, ...entry }));
    const replay = (objectKind: 'task' | 'project', entries: typeof taskEntries) => ({
      commandId: `replay-${objectKind}`,
      direction: 'undo' as const,
      receipt: {
        commandId: `forward-${objectKind}`,
        objectKind,
        action: 'replace_property' as const,
        entries,
      },
    });

    for (const missing of taskEntries) {
      expect(
        ObjectCommandReplayIn.safeParse(
          replay(
            'task',
            taskEntries.filter((entry) => entry.property !== missing.property),
          ),
        ).success,
      ).toBe(false);
    }
    for (const missing of projectEntries) {
      expect(
        ObjectCommandReplayIn.safeParse(
          replay(
            'project',
            projectEntries.filter((entry) => entry.property !== missing.property),
          ),
        ).success,
      ).toBe(false);
    }
    expect(ObjectCommandReplayIn.safeParse(replay('task', taskEntries)).success).toBe(true);
    expect(
      ObjectCommandReplayIn.safeParse(replay('project', projectEntries as typeof taskEntries))
        .success,
    ).toBe(true);
    expect(
      ObjectCommandReplayIn.safeParse(replay('task', [...taskEntries, ...taskEntries.slice(0, 1)]))
        .success,
    ).toBe(false);
    expect(
      ObjectCommandReplayIn.safeParse(
        replay('project', [...projectEntries, ...projectEntries.slice(0, 1)] as typeof taskEntries),
      ).success,
    ).toBe(false);
  });

  it('requires complete Project timeframe tuples without duplicate properties', () => {
    const objectId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const replay = (
      entries: {
        property: string;
        before: string | number | null;
        after: string | number | null;
      }[],
    ) => ({
      commandId: 'timeframe-replay',
      direction: 'undo' as const,
      receipt: {
        commandId: 'timeframe-forward',
        objectKind: 'project' as const,
        action: 'replace_property' as const,
        entries: entries.map((entry) => ({ kind: 'object' as const, objectId, ...entry })),
      },
    });
    const start = [
      { property: 'startDate', before: null, after: '2026-04-01T00:00:00.000Z' },
      { property: 'startDateResolution', before: null, after: 'quarter' },
      { property: 'startDateFiscalYearStartMonth', before: null, after: 0 },
    ];
    const target = [
      { property: 'targetDate', before: null, after: '2026-12-31T00:00:00.000Z' },
      { property: 'targetDateResolution', before: null, after: 'year' },
      { property: 'targetDateFiscalYearStartMonth', before: null, after: 0 },
    ];
    for (const tuple of [start, target]) {
      expect(ObjectCommandReplayIn.safeParse(replay(tuple)).success).toBe(true);
      for (const missing of tuple) {
        expect(
          ObjectCommandReplayIn.safeParse(
            replay(tuple.filter((entry) => entry.property !== missing.property)),
          ).success,
        ).toBe(false);
      }
      expect(
        ObjectCommandReplayIn.safeParse(replay([...tuple, ...tuple.slice(0, 1)])).success,
      ).toBe(false);
    }
  });
});

describe('ObjectCommandReplayAccess', () => {
  it('accepts a receipt preflight request and its denied target result', () => {
    const receipt = {
      commandId: 'original-command',
      objectKind: 'project' as const,
      action: 'add_dependency' as const,
      entries: [
        {
          kind: 'relation' as const,
          objectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          relation: 'dependency' as const,
          relatedId: '01BRZ3NDEKTSV4RRFFQ69G5FAV',
          before: false,
          after: true,
        },
      ],
    };

    expect(ObjectCommandReplayAccessIn.parse({ direction: 'undo', receipt })).toEqual({
      direction: 'undo',
      receipt,
    });
    expect(ObjectCommandReplayAccessIn.safeParse({ receipt }).success).toBe(false);
    expect(
      ObjectCommandReplayAccessResult.parse({
        allowed: false,
        deniedIds: ['01BRZ3NDEKTSV4RRFFQ69G5FAV'],
      }),
    ).toEqual({ allowed: false, deniedIds: ['01BRZ3NDEKTSV4RRFFQ69G5FAV'] });
  });
});
