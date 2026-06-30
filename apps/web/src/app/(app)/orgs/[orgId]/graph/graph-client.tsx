'use client';

/**
 * `graph-client` — the focused dependency-graph view (full density).
 *
 * @remarks
 * The expand target for every embed and the global Graph workspace. It is a thin shell over
 * {@link TaskGraphPanel} at full density with the filter/layout toolbar enabled — the panel owns
 * the canvas, filtering, editing, peek, and avatar/project resolution. The scope comes from the
 * server (derived from the query string).
 */
import type { JSX } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import type { TaskGraphScope } from '@/components/canvas/use-task-graph';

/** Props for {@link GraphClient}. */
export interface GraphClientProps {
  /** The scope resolved by the server from the route + query string. */
  scope: TaskGraphScope;
}

/** The focused, filterable, editable dependency canvas. */
export default function GraphClient({ scope }: GraphClientProps): JSX.Element {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex items-center gap-3 px-4 pt-3 @2xl:px-6">
        <h1 className="text-on-surface text-h2 font-semibold">Dependency graph</h1>
      </header>
      <div className="min-h-0 flex-1">
        <TaskGraphPanel scope={scope} density="full" showToolbar />
      </div>
    </div>
  );
}
