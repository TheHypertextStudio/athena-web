'use client';

/** Shared compact action bar over a Project or Task canvas selection. */
import { Ellipsis, Folder, RefreshCw, Trash2, TuneRounded, Undo } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Surface,
} from '@docket/ui/primitives';
import { useRef } from 'react';

import type { CanvasPropertySnapshot } from '@/lib/actions';

import { useCanvasActions } from './canvas-actions-context';
import { useCanvasCommandContext } from './canvas-command-context';
import CanvasPropertiesEditor from './canvas-properties-editor';
import { useOptionalCanvasPropertySnapshots } from './canvas-selection-retention';
import CanvasOverlayPanel from './canvas-overlay-panel';

/** Props for {@link BulkActionsBar}. */
export interface BulkActionsBarProps {
  /** Full property snapshots available on this canvas. */
  readonly propertySnapshots?: readonly CanvasPropertySnapshot[] | undefined;
}

/** Selection actions that remain reachable without a context-menu gesture. */
export default function BulkActionsBar({
  propertySnapshots = [],
}: BulkActionsBarProps): React.JSX.Element | null {
  const commands = useCanvasCommandContext();
  const taskActions = useCanvasActions();
  const propertiesHeadingRef = useRef<HTMLHeadingElement>(null);
  const retainedSnapshots = useOptionalCanvasPropertySnapshots();

  if (commands === null || commands.selectedObjects.length === 0) return null;
  const count = commands.selectedObjects.length;
  const availableSnapshots = retainedSnapshots ?? propertySnapshots;
  const selectedIds = new Set(commands.selectedObjects.map(({ id }) => id));
  const activeSnapshots = availableSnapshots.filter(
    ({ id, kind }) => selectedIds.has(id) && kind === commands.objectKind,
  );

  return (
    <>
      <CanvasOverlayPanel position="top-center">
        <Surface
          tone="floating"
          shape="medium"
          className="text-on-surface flex max-w-[calc(100vw-1rem)] flex-nowrap items-center gap-1 overflow-x-auto px-2 py-1.5"
          aria-label={`${String(count)} selected`}
          data-testid="canvas-selection-bar"
        >
          <span className="text-label-large px-2">{count} selected</span>
          <Button type="button" size="sm" variant="ghost" onClick={commands.openSelection}>
            <Folder className="size-4" /> Open
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!commands.canEdit}
            onClick={(event) => {
              commands.openProperties(event.currentTarget);
            }}
          >
            <TuneRounded className="size-4" /> Properties
          </Button>
          {commands.objectKind === 'task' &&
          commands.canEdit &&
          taskActions !== null &&
          count === 1 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const task = commands.selectedObjects[0];
                if (task !== undefined) taskActions.setComplete(task.id, true);
              }}
            >
              Mark done
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!commands.canTrash || commands.pending}
            onClick={commands.trashSelection}
          >
            <Trash2 className="size-4" /> Move to trash
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                iconOnly
                aria-label="More selection actions"
              >
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!commands.canUndo || commands.pending}
                onSelect={() => {
                  void commands.undo();
                }}
              >
                <Undo />
                Undo{commands.undoLabel ? ` ${commands.undoLabel}` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!commands.canRedo || commands.pending}
                onSelect={() => {
                  void commands.redo();
                }}
              >
                <RefreshCw />
                Redo{commands.redoLabel ? ` ${commands.redoLabel}` : ''}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Surface>
      </CanvasOverlayPanel>
      <Dialog
        open={commands.propertiesOpen}
        onOpenChange={(open) => {
          if (!open) commands.closeProperties();
        }}
      >
        <DialogContent
          showClose={false}
          presentation={{ kind: 'centered', size: 'compact', height: 'tall' }}
          data-testid="canvas-properties-editor"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            propertiesHeadingRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader className="flex-row items-start justify-between gap-3" inset="compact">
            <div>
              <DialogTitle asChild>
                <h2
                  ref={propertiesHeadingRef}
                  className="text-title-small text-on-surface"
                  tabIndex={-1}
                >
                  Properties
                </h2>
              </DialogTitle>
              <DialogDescription asChild>
                <p className="text-body-small text-on-surface-variant">
                  Choose a property to change for {String(count)} selected.
                </p>
              </DialogDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                commands.closeProperties();
              }}
            >
              Close
            </Button>
          </DialogHeader>
          <DialogBody
            className="flex flex-col"
            inset="compact"
            data-testid="canvas-properties-body"
          >
            <CanvasPropertiesEditor snapshots={activeSnapshots} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
