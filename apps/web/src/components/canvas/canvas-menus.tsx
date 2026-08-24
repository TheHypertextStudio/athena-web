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
import {
  Folder,
  Maximize,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TuneRounded,
  Undo,
} from '@docket/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { type Edge, type Node, useReactFlow } from '@xyflow/react';
import { type JSX, useCallback, useState } from 'react';

import { useCanvasCommandContext } from './canvas-command-context';
import { edgeKind } from './use-graph-interactions';

/** Which canvas menu is open, and where. */
interface OpenMenu {
  /** Viewport x of the pointer. */
  x: number;
  /** Viewport y. */
  y: number;
  /** The edge the menu is about, or null for the empty pane. */
  edge: Edge | null;
  /** Node subject, or null for an edge or the empty pane. */
  node: Node | null;
  /** Connected canvas element that invoked the menu, used for Properties focus return. */
  invoker: HTMLElement | null;
}

function menuInvoker(event: React.MouseEvent | MouseEvent): HTMLElement | null {
  const current = 'currentTarget' in event ? event.currentTarget : null;
  if (current instanceof HTMLElement) return current;
  return event.target instanceof HTMLElement ? event.target : null;
}

/** What {@link useCanvasMenus} hands back to the canvas. */
export interface CanvasMenus {
  /** Spread onto `<ReactFlow onEdgeContextMenu>`. */
  onEdgeContextMenu: (event: React.MouseEvent, edge: Edge) => void;
  /** Spread onto `<ReactFlow onNodeContextMenu>`. */
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
  /** Spread onto `<ReactFlow onPaneContextMenu>`. */
  onPaneContextMenu: (event: React.MouseEvent | MouseEvent) => void;
  /** The menu element, or null when nothing is open. Render inside the flow. */
  menu: JSX.Element | null;
}

/** Pane commands owned by the generic canvas rather than a domain host. */
export interface CanvasMenuOptions {
  /** Enable one area-selection gesture. */
  readonly onSelectArea: () => void;
  /** Re-run the deterministic host layout. */
  readonly onRelayout: () => void;
  /** Remove one dependency edge through the host's command history. */
  readonly onRemoveDependency?: ((sourceId: string, targetId: string) => void) | undefined;
}

/**
 * Wire the canvas's own right-click menus.
 *
 * @returns the two xyflow handlers plus the menu element to render.
 */
export function useCanvasMenus(options: CanvasMenuOptions): CanvasMenus {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const commands = useCanvasCommandContext();
  const { fitView, getNode, getNodes } = useReactFlow();

  const close = useCallback(() => {
    setOpen(null);
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    // A subtask link is changed by dragging its parent end, never by a menu, so it keeps the
    // browser's own menu rather than being given one with nothing applicable on it.
    if (edgeKind(edge) === 'subtask') return;
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, edge, node: null, invoker: menuInvoker(event) });
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen({ x: event.clientX, y: event.clientY, edge: null, node, invoker: menuInvoker(event) });
  }, []);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setOpen({
      x: event.clientX,
      y: event.clientY,
      edge: null,
      node: null,
      invoker: menuInvoker(event),
    });
  }, []);

  const titleOf = (id: string): string => {
    const node = getNode(id);
    if (node === undefined) return 'this object';
    const label = node.data['title'] ?? node.data['name'];
    return typeof label === 'string' && label.length > 0 ? label : 'this object';
  };

  const nodeLabel = (node: Node): string => {
    const label = node.data['title'] ?? node.data['name'];
    return typeof label === 'string' && label.length > 0 ? label : 'Selection';
  };

  const menu = ((): JSX.Element | null => {
    if (open === null) return null;
    const canEdit = commands?.canEdit === true;
    const removeDependency = options.onRemoveDependency;
    // An edge menu with nothing on it is worse than the browser's; a read-only viewer gets the
    // pane menu (which is only viewport commands) and no edge menu at all.
    if (open.edge !== null && (!canEdit || removeDependency === undefined)) return null;

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
          {open.node !== null ? (
            <>
              <DropdownMenuLabel>{nodeLabel(open.node)}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  commands?.openObject(open.node?.id ?? '');
                  close();
                }}
              >
                <Folder />
                Open or peek
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={commands?.canEdit !== true}
                onSelect={() => {
                  commands?.openProperties(open.invoker);
                  close();
                }}
              >
                <TuneRounded />
                Properties
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={commands === null || !commands.canTrash || commands.pending}
                onSelect={() => {
                  commands?.trashSelection();
                  close();
                }}
              >
                <Trash2 />
                Move to trash
              </DropdownMenuItem>
            </>
          ) : open.edge === null ? (
            <>
              {commands?.canEdit === true ? (
                <DropdownMenuItem
                  onSelect={() => {
                    commands.createObject(
                      open.invoker?.closest<HTMLElement>('[data-canvas-selection-frame]') ??
                        open.invoker,
                    );
                    close();
                  }}
                >
                  <Plus />
                  New {commands.objectKind === 'project' ? 'Project' : 'Task'}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={() => {
                  options.onSelectArea();
                  close();
                }}
              >
                <Search />
                Select area
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={commands === null || !commands.canUndo || commands.pending}
                onSelect={() => {
                  void commands?.undo();
                  close();
                }}
              >
                <Undo />
                Undo{commands?.undoLabel ? ` ${commands.undoLabel}` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={commands === null || !commands.canRedo || commands.pending}
                onSelect={() => {
                  void commands?.redo();
                  close();
                }}
              >
                <RefreshCw />
                Redo{commands?.redoLabel ? ` ${commands.redoLabel}` : ''}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!getNodes().some(({ selected }) => selected)}
                onSelect={() => {
                  const selected = getNodes().filter(({ selected }) => selected);
                  void fitView({ nodes: selected, duration: 300, maxZoom: 1, padding: 0.3 });
                  close();
                }}
              >
                <Search />
                Fit selection
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void fitView({ duration: 300, minZoom: 0.1, padding: 0.15 });
                  close();
                }}
              >
                <Maximize />
                Fit all
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  options.onRelayout();
                  close();
                }}
              >
                <RefreshCw />
                Re-layout
              </DropdownMenuItem>
            </>
          ) : removeDependency !== undefined ? (
            <EdgeItems
              edge={open.edge}
              titleOf={titleOf}
              onRemove={removeDependency}
              onDone={close}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  })();

  return { onEdgeContextMenu, onNodeContextMenu, onPaneContextMenu, menu };
}

/** The items for one dependency edge, named after the two tasks it joins. */
function EdgeItems({
  edge,
  titleOf,
  onRemove,
  onDone,
}: {
  edge: Edge;
  titleOf: (id: string) => string;
  onRemove: (sourceId: string, targetId: string) => void;
  onDone: () => void;
}): JSX.Element {
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
          onRemove(edge.source, edge.target);
          onDone();
        }}
      >
        <Trash2 />
        Remove dependency
      </DropdownMenuItem>
    </>
  );
}
