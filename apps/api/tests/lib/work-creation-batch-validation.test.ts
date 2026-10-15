import { describe, expect, it } from 'vitest';
import { TeamId } from '@docket/identity-access/ids';
import { validateCreationBatch } from '../../src/lib/work-creation/context';
import type {
  OrdinaryWorkCommand,
  WorkCreationBatchCommand,
} from '../../src/lib/work-creation/types';

const invocation = {
  origin: { v: 2, channel: 'app', performer: { kind: 'person' }, tool: 'project_create' },
} as const;
function root(
  key: string,
  orgId = 'workspace',
  milestoneCount = 0,
): WorkCreationBatchCommand['roots'][number] {
  return {
    key,
    command: {
      kind: 'project',
      caller: { orgId, actorId: 'person', capabilities: ['manage'], roleId: null },
      body: {
        name: key,
        milestones: Array.from({ length: milestoneCount }, (_, index) => ({ name: String(index) })),
      },
      invocation,
    },
  };
}

describe('trusted work forest validation', () => {
  it('accepts qualified descendant endpoints and distinguishes Tasks within the same root', () => {
    expect(
      validateCreationBatch({
        roots: [root('event')],
        invocation,
        edges: [
          {
            blocker: { rootKey: 'event', path: ['prepare'] },
            blocked: { rootKey: 'event', path: ['serve'] },
          },
        ],
      }),
    ).toBe(1);
  });
  it('rejects a dependency cycle before allocating or inserting any work', () => {
    const task = (key: string): WorkCreationBatchCommand['roots'][number] => ({
      key,
      command: {
        kind: 'task',
        caller: {
          orgId: 'workspace',
          actorId: 'person',
          roleId: null,
          capabilities: ['contribute'],
        },
        body: { title: key, teamId: TeamId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV') },
        invocation,
      },
    });
    const edge = (from: string, to: string) => ({
      blocker: { rootKey: from, path: [] },
      blocked: { rootKey: to, path: [] },
    });
    expect(() =>
      validateCreationBatch({
        roots: [task('a'), task('b')],
        invocation,
        edges: [edge('a', 'b'), edge('b', 'a')],
      }),
    ).toThrow();
  });
  it('accepts exactly500 new rows including explicit checkpoints', () => {
    const roots = Array.from({ length: 250 }, (_, index) => root(String(index), 'workspace', 1));
    expect(validateCreationBatch({ roots, edges: [], invocation })).toBe(500);
    expect(() =>
      validateCreationBatch({ roots: [...roots, root('overflow')], edges: [], invocation }),
    ).toThrow();
  });
  it('rejects duplicate keys, foreign workspaces and differing initiating actors', () => {
    expect(() => validateCreationBatch({ roots: [], edges: [], invocation })).toThrow();
    expect(() =>
      validateCreationBatch({ roots: [root('same'), root('same')], edges: [], invocation }),
    ).toThrow();
    expect(() =>
      validateCreationBatch({
        roots: [root('one'), root('two', 'foreign')],
        edges: [],
        invocation,
      }),
    ).toThrow();
    const other = root('other');
    const command = {
      ...other.command,
      caller: { ...other.command.caller, actorId: 'someone-else' },
    } as OrdinaryWorkCommand;
    expect(() =>
      validateCreationBatch({
        roots: [root('one'), { key: other.key, command }],
        edges: [],
        invocation,
      }),
    ).toThrow();
  });
  it('rejects unknown dependency endpoints and non-task dependencies before any insert', () => {
    expect(() =>
      validateCreationBatch({
        roots: [root('one')],
        invocation,
        edges: [
          { blocker: { rootKey: 'one', path: [] }, blocked: { rootKey: 'missing', path: [] } },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateCreationBatch({
        roots: [root('one'), root('two')],
        invocation,
        edges: [{ blocker: { rootKey: 'one', path: [] }, blocked: { rootKey: 'two', path: [] } }],
      }),
    ).toThrow();
  });
});
