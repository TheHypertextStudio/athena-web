import { describe, it, expect } from 'vitest';
import { getStatusColor, computeTopologicalOrder } from './useDependencyGraph';
import type { TaskNodeType } from './TaskNode';
import type { DependencyEdgeType } from './DependencyEdge';

describe('useDependencyGraph', () => {
  describe('getStatusColor', () => {
    it('returns primary color for completed status', () => {
      expect(getStatusColor('completed')).toBe('var(--md-sys-color-primary)');
    });

    it('returns tertiary color for in_progress status', () => {
      expect(getStatusColor('in_progress')).toBe('var(--md-sys-color-tertiary)');
    });

    it('returns error color for cancelled status', () => {
      expect(getStatusColor('cancelled')).toBe('var(--md-sys-color-error)');
    });

    it('returns outline-variant color for pending status', () => {
      expect(getStatusColor('pending')).toBe('var(--md-sys-color-outline-variant)');
    });

    it('returns outline-variant color for unknown status', () => {
      // @ts-expect-error - testing unknown status
      expect(getStatusColor('unknown')).toBe('var(--md-sys-color-outline-variant)');
    });
  });

  describe('computeTopologicalOrder', () => {
    const createNode = (id: string): TaskNodeType => ({
      id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: {
        id,
        title: `Task ${id}`,
        status: 'pending',
        priority: 'medium',
        assignee: null,
        deadline: null,
        isBlocking: false,
        color: 'var(--md-sys-color-outline-variant)',
      },
    });

    const createEdge = (source: string, target: string): DependencyEdgeType => ({
      id: `${source}->${target}`,
      source,
      target,
      type: 'dependency',
      data: { type: 'blocks', isOnCriticalPath: false },
    });

    it('returns empty array for empty graph', () => {
      const result = computeTopologicalOrder([], []);
      expect(result).toEqual([]);
    });

    it('returns single node for graph with one node', () => {
      const nodes = [createNode('A')];
      const result = computeTopologicalOrder(nodes, []);
      expect(result).toEqual(['A']);
    });

    it('returns nodes in correct order for linear chain (A -> B -> C)', () => {
      const nodes = [createNode('A'), createNode('B'), createNode('C')];
      const edges = [createEdge('A', 'B'), createEdge('B', 'C')];

      const result = computeTopologicalOrder(nodes, edges);

      // A must come before B, B must come before C
      expect(result.indexOf('A')).toBeLessThan(result.indexOf('B'));
      expect(result.indexOf('B')).toBeLessThan(result.indexOf('C'));
    });

    it('returns nodes in correct order for diamond graph', () => {
      // A -> B -> D
      // A -> C -> D
      const nodes = [createNode('A'), createNode('B'), createNode('C'), createNode('D')];
      const edges = [
        createEdge('A', 'B'),
        createEdge('A', 'C'),
        createEdge('B', 'D'),
        createEdge('C', 'D'),
      ];

      const result = computeTopologicalOrder(nodes, edges);

      // A must come first
      expect(result[0]).toBe('A');
      // D must come last
      expect(result[3]).toBe('D');
      // B and C must be between A and D
      expect(result.indexOf('B')).toBeGreaterThan(0);
      expect(result.indexOf('B')).toBeLessThan(3);
      expect(result.indexOf('C')).toBeGreaterThan(0);
      expect(result.indexOf('C')).toBeLessThan(3);
    });

    it('handles disconnected components', () => {
      const nodes = [createNode('A'), createNode('B'), createNode('X'), createNode('Y')];
      const edges = [createEdge('A', 'B'), createEdge('X', 'Y')];

      const result = computeTopologicalOrder(nodes, edges);

      // All nodes should be present
      expect(result).toHaveLength(4);
      expect(result).toContain('A');
      expect(result).toContain('B');
      expect(result).toContain('X');
      expect(result).toContain('Y');
      // Dependencies should be respected
      expect(result.indexOf('A')).toBeLessThan(result.indexOf('B'));
      expect(result.indexOf('X')).toBeLessThan(result.indexOf('Y'));
    });

    it('handles graph with no edges (all independent nodes)', () => {
      const nodes = [createNode('A'), createNode('B'), createNode('C')];
      const edges: DependencyEdgeType[] = [];

      const result = computeTopologicalOrder(nodes, edges);

      // All nodes should be present (order doesn't matter)
      expect(result).toHaveLength(3);
      expect(result).toContain('A');
      expect(result).toContain('B');
      expect(result).toContain('C');
    });

    it('handles cyclic graph by including all nodes', () => {
      // A -> B -> C -> A (cycle)
      const nodes = [createNode('A'), createNode('B'), createNode('C')];
      const edges = [createEdge('A', 'B'), createEdge('B', 'C'), createEdge('C', 'A')];

      const result = computeTopologicalOrder(nodes, edges);

      // Should still include all nodes (cycle handling)
      expect(result).toHaveLength(3);
      expect(result).toContain('A');
      expect(result).toContain('B');
      expect(result).toContain('C');
    });

    it('handles multiple root nodes', () => {
      // A -> C
      // B -> C
      const nodes = [createNode('A'), createNode('B'), createNode('C')];
      const edges = [createEdge('A', 'C'), createEdge('B', 'C')];

      const result = computeTopologicalOrder(nodes, edges);

      // C must come after both A and B
      expect(result.indexOf('C')).toBeGreaterThan(result.indexOf('A'));
      expect(result.indexOf('C')).toBeGreaterThan(result.indexOf('B'));
    });
  });
});
