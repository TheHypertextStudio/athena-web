import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { layoutMeasuredGraph } from '@/components/canvas/graph-layout-engine';
import { layoutProjectGraph } from '@/components/canvas/project-graph-layout';

const LAYOUT_BUDGET_MS = 100;

describe('Canvas graph layout performance', () => {
  it('lays out the 36-project release fixture within 100ms', () => {
    const nodes: Node[] = Array.from({ length: 36 }, (_, index) => ({
      id: `project-${index.toString().padStart(2, '0')}`,
      position: { x: 0, y: 0 },
      data: { name: `Project ${index + 1}` },
    }));
    const edges: Edge[] = Array.from({ length: 11 }, (_, index) => ({
      id: `dependency-${index}`,
      source: nodes[index * 2]?.id ?? '',
      target: nodes[index * 2 + 1]?.id ?? '',
    }));

    const result = layoutProjectGraph(nodes, edges, 16 / 9);

    expect(result.layout.diagnostics.durationMs).toBeLessThanOrEqual(LAYOUT_BUDGET_MS);
  });

  it('lays out the 363-task and 28-dependency fixture within 100ms', () => {
    const tasks = Array.from({ length: 363 }, (_, index) => ({
      id: `task-${index}`,
      width: 240,
      height: 56,
    }));
    const dependencies = Array.from({ length: 28 }, (_, index) => ({
      source: `task-${index}`,
      target: `task-${index + 1}`,
    }));

    const result = layoutMeasuredGraph(tasks, dependencies, {
      direction: 'LR',
      aspectRatio: 16 / 9,
    });

    expect(result.diagnostics.durationMs).toBeLessThanOrEqual(LAYOUT_BUDGET_MS);
  });
});
