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
import { ChevronLeft } from '@docket/ui/icons';
import Link from 'next/link';
import type { JSX } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { useGraphUrlState } from '@/components/canvas/use-graph-url-state';
import type { TaskGraphScope } from '@/components/canvas/use-task-graph';

/** Props for {@link GraphClient}. */
export interface GraphClientProps {
  /** The scope resolved by the server from the route + query string. */
  scope: TaskGraphScope;
}

/**
 * The context the focused graph was expanded from, so we can offer a real "back" — a
 * task-neighborhood returns to that task, a project scope to that project, else the workspace.
 */
function backTarget(scope: TaskGraphScope): { href: string; label: string } {
  if (scope.rootTaskId !== undefined)
    return { href: `/orgs/${scope.orgId}/tasks/${scope.rootTaskId}`, label: 'Back to task' };
  if (scope.projectId !== undefined)
    return { href: `/orgs/${scope.orgId}/projects/${scope.projectId}`, label: 'Back to project' };
  return { href: `/orgs/${scope.orgId}`, label: 'Back to workspace' };
}

/** The focused, filterable, editable dependency canvas (filter + layout persist to the URL). */
export default function GraphClient({ scope }: GraphClientProps): JSX.Element {
  const { filter, direction, setFilter, setDirection } = useGraphUrlState();
  const back = backTarget(scope);
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex flex-col gap-1 px-4 pt-3 @2xl:px-6">
        <Link
          href={back.href}
          className="text-on-surface-variant hover:text-on-surface inline-flex w-fit items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
        <h1 className="text-on-surface text-title-medium font-semibold">Dependency graph</h1>
      </header>
      <div className="min-h-0 flex-1">
        <TaskGraphPanel
          scope={scope}
          density="full"
          showToolbar
          filter={filter}
          onFilterChange={setFilter}
          direction={direction}
          onDirectionChange={setDirection}
        />
      </div>
    </div>
  );
}
