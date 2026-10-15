import { describe, expect, it } from 'vitest';
import {
  validatePreparedBlueprintForest,
  type PreflightedForestRoot,
} from '../../src/lib/work-template-blueprints/forest';
import type { WorkCreationBatchCommand } from '../../src/lib/work-creation/types';
const invocation = {
  origin: { v: 2, channel: 'app', performer: { kind: 'person' }, tool: 'project_create' },
} as const;
function command(edges: WorkCreationBatchCommand['edges'] = []): WorkCreationBatchCommand {
  return {
    roots: ['one', 'two'].map((key) => ({
      key,
      command: {
        kind: 'project',
        body: { name: key },
        caller: { orgId: 'workspace', actorId: 'person', roleId: null, capabilities: ['manage'] },
        invocation,
      },
    })),
    invocation,
    edges,
  };
}
function plan(prefix: string, rowCount = 2): PreflightedForestRoot {
  return {
    rowCount,
    entries: [
      { allocated: { id: `${prefix}-root`, node: { kind: 'project', path: [] } } },
      { allocated: { id: `${prefix}-child`, node: { kind: 'task', path: ['prepare'] } } },
    ],
    tree: { dependencies: [] },
  };
}
const edge = (from: string, to: string) => ({
  blocker: { rootKey: from, path: ['prepare'] },
  blocked: { rootKey: to, path: ['prepare'] },
});
describe('aggregate blueprint forest preflight', () => {
  it('counts descendants and explicit checkpoints across every root before writing', () => {
    expect(
      validatePreparedBlueprintForest(command(), [plan('one', 250), plan('two', 250)]),
    ).toEqual([]);
    expect(() =>
      validatePreparedBlueprintForest(command(), [plan('one', 250), plan('two', 251)]),
    ).toThrow();
  });
  it('resolves qualified descendant endpoints against their own root', () => {
    expect(
      validatePreparedBlueprintForest(command([edge('one', 'two')]), [plan('one'), plan('two')]),
    ).toEqual([{ blockerId: 'one-child', blockedId: 'two-child' }]);
  });
  it('refuses missing or non-Task endpoints and dependency cycles', () => {
    expect(() =>
      validatePreparedBlueprintForest(command([edge('one', 'missing')]), [
        plan('one'),
        plan('two'),
      ]),
    ).toThrow();
    expect(() =>
      validatePreparedBlueprintForest(command([edge('one', 'two'), edge('two', 'one')]), [
        plan('one'),
        plan('two'),
      ]),
    ).toThrow();
    expect(() =>
      validatePreparedBlueprintForest(
        command([
          { blocker: { rootKey: 'one', path: [] }, blocked: { rootKey: 'two', path: ['prepare'] } },
        ]),
        [plan('one'), plan('two')],
      ),
    ).toThrow();
  });
});
