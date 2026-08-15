/**
 * Unit tests for the dependency-graph annotation logic.
 *
 * @remarks
 * Pure logic, so it earns its own gate independent of the canvas React tree: a task is blocked
 * while any blocker is open, ready once every blocker has ended and it hasn't started, and each
 * dependency edge's tone follows its blocker's completion. Nodes carry the status *category* they
 * behave as, which is what the caller resolves from the workspace's set before annotating.
 */
import { describe, expect, it } from 'vitest';

import type { WorkStatusCategory } from '@docket/types';

import {
  type AnnotateEdge,
  type AnnotateNode,
  annotateGraph,
} from '@/components/canvas/graph-annotate';

/** Build a graph fixture from terse node/edge tuples. */
function graph(
  nodes: readonly [id: string, stateType: WorkStatusCategory][],
  edges: readonly [kind: 'dependency' | 'subtask', source: string, target: string][],
): { nodes: AnnotateNode[]; edges: AnnotateEdge[] } {
  return {
    nodes: nodes.map(([id, stateType]) => ({ id, stateType })),
    edges: edges.map(([kind, source, target]) => ({
      id: `${kind}:${source}:${target}`,
      kind,
      source,
      target,
    })),
  };
}

describe('annotateGraph — blocked / ready', () => {
  it('marks a task blocked while any blocker is open', () => {
    const { nodeFlags } = annotateGraph(
      graph(
        [
          ['a', 'started'],
          ['b', 'unstarted'],
        ],
        [['dependency', 'a', 'b']], // a blocks b; a is open
      ),
    );
    expect(nodeFlags.get('b')).toEqual({ isBlocked: true, isReady: false });
    expect(nodeFlags.get('a')).toEqual({ isBlocked: false, isReady: false }); // no blockers
  });

  it('marks a task ready once every blocker is complete and it has not started', () => {
    const { nodeFlags } = annotateGraph(
      graph(
        [
          ['a', 'completed'],
          ['b', 'canceled'],
          ['c', 'unstarted'],
        ],
        [
          ['dependency', 'a', 'c'],
          ['dependency', 'b', 'c'],
        ],
      ),
    );
    expect(nodeFlags.get('c')).toEqual({ isBlocked: false, isReady: true });
  });

  it('is neither blocked nor ready once the task itself is started, even with done blockers', () => {
    const { nodeFlags } = annotateGraph(
      graph(
        [
          ['a', 'completed'],
          ['b', 'started'],
        ],
        [['dependency', 'a', 'b']],
      ),
    );
    expect(nodeFlags.get('b')).toEqual({ isBlocked: false, isReady: false });
  });

  it('ignores subtask edges for blocking', () => {
    const { nodeFlags } = annotateGraph(
      graph(
        [
          ['parent', 'unstarted'],
          ['child', 'unstarted'],
        ],
        [['subtask', 'parent', 'child']],
      ),
    );
    expect(nodeFlags.get('child')).toEqual({ isBlocked: false, isReady: false });
  });
});

describe('annotateGraph — edge tone', () => {
  it('tones a dependency edge by its blocker completion and keeps subtasks neutral', () => {
    const { edgeTone } = annotateGraph(
      graph(
        [
          ['a', 'completed'],
          ['b', 'started'],
          ['c', 'unstarted'],
          ['d', 'unstarted'],
        ],
        [
          ['dependency', 'a', 'c'], // blocker done
          ['dependency', 'b', 'c'], // blocker open
          ['subtask', 'c', 'd'],
        ],
      ),
    );
    expect(edgeTone.get('dependency:a:c')).toBe('done');
    expect(edgeTone.get('dependency:b:c')).toBe('open');
    expect(edgeTone.get('subtask:c:d')).toBe('neutral');
  });
});
