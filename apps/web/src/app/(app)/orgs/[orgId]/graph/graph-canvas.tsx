'use client';

/**
 * `graph-canvas` — the focused Task graph view (full density).
 *
 * @remarks
 * The expand target for every embed and the global Graph workspace. It is a thin shell over
 * {@link TaskGraphPanel} at full density with the shared view bar enabled — the panel owns the
 * canvas, filtering, editing, peek, and avatar/project resolution.
 *
 * The scope arrives as a prop, which is why this is not the route's entry point: the offline route
 * table mounts a route with no props. `graph-client.tsx` resolves the scope from the URL and renders
 * this.
 *
 * The page chrome is one {@link AppBar}: the back affordance, the title, and the view controls are
 * slots in a single tonal band, so nothing here spells out a background or draws a rule. The canvas
 * below sits on the page surface, and the tonal step between the two is what separates them.
 */
import { AppBar } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import { Button, Surface, Tooltip, TooltipContent, TooltipTrigger } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { useGraphDisplay } from '@/components/canvas/use-graph-display';
import type { TaskGraphScope } from '@/components/canvas/use-task-graph';
import { useViewState } from '@/components/views/use-view-state';

/** Props for {@link GraphCanvas}. */
export interface GraphCanvasProps {
  /** The scope resolved from the route and query string. */
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
  return { href: `/orgs/${scope.orgId}/my-work`, label: 'Back to workspace' };
}

/** The focused, filterable, editable Task graph (query + presentation persist to the URL). */
export default function GraphCanvas({ scope }: GraphCanvasProps): JSX.Element {
  const { state, setFilters, setGroupBy } = useViewState();
  const { display, patchDisplay } = useGraphDisplay();
  const back = backTarget(scope);
  return (
    <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
      <TaskGraphPanel
        scope={scope}
        density="full"
        viewState={state}
        onFiltersChange={setFilters}
        onGroupByChange={setGroupBy}
        display={display}
        onDisplayChange={patchDisplay}
        className="min-h-0 flex-1"
        renderChrome={(bar) => (
          <AppBar
            title="Task graph"
            navigation={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" iconOnly asChild aria-label={back.label}>
                    <Link href={back.href}>
                      <ChevronLeft aria-hidden="true" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{back.label}</TooltipContent>
              </Tooltip>
            }
            controls={bar}
          />
        )}
      />
    </Surface>
  );
}
