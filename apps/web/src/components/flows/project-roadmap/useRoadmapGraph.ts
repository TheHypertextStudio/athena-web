'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNodesState, useEdgesState } from '@xyflow/react';
import { projectsApi, initiativesApi, type Project, type Initiative } from '@/lib/api-client';
import { getLayoutedElements } from '../shared/layout-utils';
import type { InitiativeNodeType, InitiativeNodeData } from './InitiativeNode';
import type { ProjectNodeType, ProjectNodeData } from './ProjectNode';
import type { TimelineEdgeType, TimelineEdgeData } from './TimelineEdge';

interface UseRoadmapGraphOptions {
  initiativeId?: string;
  includeCompleted?: boolean;
}

type RoadmapNode = InitiativeNodeType | ProjectNodeType;
type RoadmapEdge = TimelineEdgeType;

const roadmapKeys = {
  all: ['roadmap'] as const,
  graph: (initiativeId?: string) => [...roadmapKeys.all, 'graph', initiativeId ?? 'all'] as const,
};

/**
 * Transforms initiatives and projects into roadmap nodes and edges.
 */
function buildRoadmapGraph(
  initiatives: Initiative[],
  projects: Project[],
  options: { includeCompleted?: boolean } = {},
): { nodes: RoadmapNode[]; edges: RoadmapEdge[] } {
  const { includeCompleted = false } = options;

  const nodes: RoadmapNode[] = [];
  const edges: RoadmapEdge[] = [];
  const initiativeProjects = new Map<string, Project[]>();

  // Group projects by initiative
  for (const project of projects) {
    if (!includeCompleted && (project.status === 'completed' || project.status === 'archived')) {
      continue;
    }

    const initId = project.initiativeId ?? 'no-initiative';
    const existing = initiativeProjects.get(initId) ?? [];
    initiativeProjects.set(initId, [...existing, project]);
  }

  // Create initiative nodes
  for (const initiative of initiatives) {
    if (
      !includeCompleted &&
      (initiative.status === 'completed' || initiative.status === 'archived')
    ) {
      continue;
    }

    const initiativeProjectsList = initiativeProjects.get(initiative.id) ?? [];

    const nodeData: InitiativeNodeData = {
      id: initiative.id,
      name: initiative.name,
      status: initiative.status,
      projectCount: initiativeProjectsList.length,
      color: 'var(--md-sys-color-tertiary)',
    };

    nodes.push({
      id: initiative.id,
      type: 'initiative',
      position: { x: 0, y: 0 },
      data: nodeData,
    });

    // Create edges from parent to child initiatives
    if (initiative.parentId) {
      const edgeData: TimelineEdgeData = { type: 'hierarchy' };
      edges.push({
        id: `init-${initiative.parentId}->${initiative.id}`,
        source: initiative.parentId,
        target: initiative.id,
        type: 'timeline',
        data: edgeData,
      });
    }
  }

  // Create project nodes
  for (const project of projects) {
    if (!includeCompleted && (project.status === 'completed' || project.status === 'archived')) {
      continue;
    }

    const nodeData: ProjectNodeData = {
      id: project.id,
      name: project.name,
      status: project.status,
      progress: 0, // Would need task completion data to calculate
      initiativeId: project.initiativeId,
      color: 'var(--md-sys-color-primary)',
    };

    nodes.push({
      id: project.id,
      type: 'project',
      position: { x: 0, y: 0 },
      data: nodeData,
    });

    // Create edge from initiative to project
    if (project.initiativeId) {
      const edgeData: TimelineEdgeData = { type: 'hierarchy' };
      edges.push({
        id: `proj-${project.initiativeId}->${project.id}`,
        source: project.initiativeId,
        target: project.id,
        type: 'timeline',
        data: edgeData,
      });
    }
  }

  return getLayoutedElements<RoadmapNode, RoadmapEdge>(nodes, edges, {
    direction: 'TB',
    nodeSep: 60,
    rankSep: 120,
    nodeWidth: 220,
    nodeHeight: 100,
  });
}

/**
 * Hook for managing a project roadmap graph.
 */
export function useRoadmapGraph(options: UseRoadmapGraphOptions = {}) {
  const { initiativeId, includeCompleted = false } = options;

  const {
    data: initiativesData,
    isLoading: initiativesLoading,
    error: initiativesError,
  } = useQuery({
    queryKey: ['initiatives', { status: includeCompleted ? undefined : 'active' }],
    queryFn: () => initiativesApi.list(includeCompleted ? undefined : { status: 'active' }),
  });

  const {
    data: projectsData,
    isLoading: projectsLoading,
    error: projectsError,
  } = useQuery({
    queryKey: ['projects', { initiativeId }],
    queryFn: () => projectsApi.list(initiativeId ? { initiativeId } : undefined),
  });

  const isLoading = initiativesLoading || projectsLoading;
  const error = initiativesError ?? projectsError;

  const initialGraph = useMemo(() => {
    if (!initiativesData || !projectsData) return { nodes: [], edges: [] };
    return buildRoadmapGraph(initiativesData.data, projectsData.data, { includeCompleted });
  }, [initiativesData, projectsData, includeCompleted]);

  const [nodes, _setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    isLoading,
    error,
  };
}

export { roadmapKeys };
