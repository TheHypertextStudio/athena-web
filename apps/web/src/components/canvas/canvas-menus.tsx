'use client';

/**
 * `components/canvas/canvas-menus` — right-click menus for the two things that are not objects.
 *
 * @remarks
 * A task node's menu comes from the app's action registry, because a task is a core object that
 * appears on many surfaces and must offer the same actions on all of them. A dependency edge and
 * the empty canvas are the opposite: neither exists anywhere but here, and neither is something a
 * command palette could sensibly list. Routing them through the registry would mean inventing
 * object kinds for a line and for empty space, which is exactly the coupling that design avoids.
 *
 * ## Why these do not use `ContextMenuTrigger`
 *
 * The obvious shape — wrap the canvas in a `<ContextMenu>` — opens the pane's menu for a
 * right-click on a *node* too, because the event bubbles to the wrapper, and the node already has
 * its own menu from the global handler. Two menus for one gesture. xyflow already discriminates
 * the target for us through `onEdgeContextMenu` / `onPaneContextMenu`, so this module takes those
 * events and renders one menu anchored at the pointer, the same way the object menu does.
 */
import { Maximize, RefreshCw, Trash2, Workflow } from '@docket/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { type Edge, useReactFlow } from '@xyflow/react';
import { type JSX, useCallback, useState } from 'react';

import { useCanvasActions } from './canvas-actions-context';
import { edgeKind } from './use-graph-interactions';
import { taskData } from './task-node';

/** Which canvas menu is open, and where. */
interface OpenMenu {
  /** Viewport x of the pointer. */
  x: number;
  /** Viewport y. */
  y: number;
  /** The edge the menu is about, or null for the empty pane. */
  edge: Edge | null;
}

/** What {@link useCanvasMenus} hands back to the canvas. */
export interface CanvasMenus {
  /** Spread onto `<ReactFlow onEdgeContextMenu>`. */
  onEdgeContextMenu: (event: React.MouseEvent, edge: Edge) => void;
  /** Spread onto `<ReactFlow onPaneContextMenu>`. */
  onPaneContextMenu: (event: React.MouseEvent | MouseEvent) => void;
  /** The menu element, or null when nothing is open. Render inside the flow. */
  menu: JSX.Element | null;
}

/**
 * Wire the canvas's own right-click menus.
 *
 * @returns the two xyflow handlers plus the menu element to render.
 */
export function useCanvasMenus(): CanvasMenus {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const actions = useCanvasActions();
  const { fitView, zoomTo, getNode } = useReactFlow();

  const close = useCallback(() => {
    setOpen(null);
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    // A subtask link is changed by dragging its parent end, never by a menu, so it keeps the
    // browser's own menu rather than being given one with nothing applicable on it.
    if (edgeKind(edge) === 'subtask') return;
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, edge });
  }, []);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, edge: null });
  }, []);

  const titleOf = (id: string): string => {
    const node = getNode(id);
    return node === undefined ? 'this task' : taskData(node).title;
  };

  const menu = ((): JSX.Element | null => {
    if (open === null) return null;
    const canEdit = actions?.canEdit === true;
    // An edge menu with nothing on it is worse than the browser's; a read-only viewer gets the
    // pane menu (which is only viewport commands) and no edge menu at all.
    if (open.edge !== null && !canEdit) return null;

    return (
      <DropdownMenu
        open
        modal={false}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            style={{ position: 'fixed', left: open.x, top: open.y, width: 0, height: 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={0} className="min-w-56">
          {open.edge === null ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  void fitView({ duration: 300 });
                  close();
                }}
              >
                <Maximize />
                Fit to view
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void zoomTo(1, { duration: 300 });
                  close();
                }}
              >
                <RefreshCw />
                Reset zoom
              </DropdownMenuItem>
            </>
          ) : (
            <EdgeItems edge={open.edge} titleOf={titleOf} onDone={close} />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  })();

  return { onEdgeContextMenu, onPaneContextMenu, menu };
}

/** The items for one dependency edge, named after the two tasks it joins. */
function EdgeItems({
  edge,
  titleOf,
  onDone,
}: {
  edge: Edge;
  titleOf: (id: string) => string;
  onDone: () => void;
}): JSX.Element {
  const actions = useCanvasActions();
  const source = titleOf(edge.source);
  const target = titleOf(edge.target);
  return (
    <>
      <DropdownMenuLabel>
        {source} → {target}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          actions?.reverseDependency(edge.source, edge.target);
          onDone();
        }}
      >
        <Workflow />
        Reverse direction
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          actions?.removeDependency(edge.source, edge.target);
          onDone();
        }}
      >
        <Trash2 />
        Remove dependency
      </DropdownMenuItem>
    </>
  );
}
