'use client';

/**
 * `graph-client` — the focused dependency-graph view (full density).
 *
 * @remarks
 * The expand target for every embed and the global Graph workspace. It feeds the scope (from the
 * server, derived from the query string) into the generic {@link Canvas} at full density, and adds
 * a lightweight Linear-style filter bar (title search + hide-completed) over the node set. Edges
 * are pruned to surviving endpoints. Filter changes flow through the canvas's own View-Transition
 * re-sync, so the matching nodes morph rather than hard-swap. Richer filtering (the full views
 * engine) is a follow-up — it needs richer node fields than the slim graph payload carries.
 */
import { EmptyState } from '@docket/ui/components';
import { Workflow } from '@docket/ui/icons';
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type Edge, type Node } from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';

import Canvas from '@/components/canvas/canvas';
import TaskNode from '@/components/canvas/task-node';
import type { TaskNodeData } from '@/components/canvas/task-node';
import { type TaskGraphScope, useTaskGraph } from '@/components/canvas/use-task-graph';
import { stateTypeOf } from '@/lib/work-state';
import { startViewTransition } from '@/lib/view-transition';

/** Stable node-type registry (must not be re-created per render). */
const NODE_TYPES = { task: TaskNode };

/** Props for {@link GraphClient}. */
export interface GraphClientProps {
  /** The scope resolved by the server from the route + query string. */
  scope: TaskGraphScope;
}

/** The focused, filterable dependency canvas. */
export default function GraphClient({ scope }: GraphClientProps): React.JSX.Element {
  const router = useRouter();
  const { nodes, edges, isLoading, error, isEmpty } = useTaskGraph(scope, 'full');
  const [search, setSearch] = useState('');
  const [hideDone, setHideDone] = useState(false);

  const filtered = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const needle = search.trim().toLowerCase();
    const keep = (n: Node): boolean => {
      const d = n.data as TaskNodeData;
      if (needle.length > 0 && !d.title.toLowerCase().includes(needle)) return false;
      if (hideDone) {
        const type = stateTypeOf(d.state);
        if (type === 'completed' || type === 'canceled') return false;
      }
      return true;
    };
    const keptNodes = nodes.filter(keep);
    const keptIds = new Set(keptNodes.map((n) => n.id));
    const keptEdges = edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
    return { nodes: keptNodes, edges: keptEdges };
  }, [nodes, edges, search, hideDone]);

  const onNodeClick = useCallback(
    (id: string) => {
      router.push(`/orgs/${scope.orgId}/tasks/${id}`);
    },
    [router, scope.orgId],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex items-center gap-3 border-b border-outline-variant px-4 py-3 @2xl:px-6">
        <h1 className="text-on-surface text-h2 font-semibold">Dependency graph</h1>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Filter by title…"
            className="h-8 w-56"
            aria-label="Filter tasks by title"
          />
          <Button
            type="button"
            size="sm"
            variant={hideDone ? 'default' : 'outline'}
            onClick={() => {
              startViewTransition(() => {
                setHideDone((v) => !v);
              });
            }}
            aria-pressed={hideDone}
          >
            Hide done
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <Skeleton className="absolute inset-2 rounded-lg" />
        ) : error !== null ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={Workflow} title="Couldn’t load the graph" body={error} />
          </div>
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={Workflow}
              title="No dependencies yet"
              body="Tasks in this scope have no dependency or subtask links to map."
            />
          </div>
        ) : (
          <Canvas
            nodes={filtered.nodes}
            edges={filtered.edges}
            nodeTypes={NODE_TYPES}
            density="full"
            onNodeClick={onNodeClick}
          />
        )}
      </div>
    </div>
  );
}
