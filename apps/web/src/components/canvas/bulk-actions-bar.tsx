'use client';

/**
 * Shared compact action bar over a Project or Task canvas selection.
 *
 * @remarks
 * Two pieces, so a host can place them itself: {@link BulkSelectionActions} is the row of
 * actions, and {@link BulkPropertiesDialog} is the Properties editor those actions open. The
 * default export is the embed's own composition: the actions in a floating panel at the top of
 * the canvas, with the dialog beside it. A host with a floating bar puts the actions in that
 * bar's selection slot and renders the dialog alone.
 */
import {
  CheckCircle2,
  Ellipsis,
  Folder,
  RefreshCw,
  Trash2,
  TuneRounded,
  Undo,
} from '@docket/ui/icons';
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
import { type CanvasCommandContextValue, useCanvasCommandContext } from './canvas-command-context';
import CanvasPropertiesEditor from './canvas-properties-editor';
import { useOptionalCanvasPropertySnapshots } from './canvas-selection-retention';
import CanvasOverlayPanel from './canvas-overlay-panel';

/** Props for {@link BulkActionsBar}. */
export interface BulkActionsBarProps {
  /** Full property snapshots available on this canvas. */
  readonly propertySnapshots?: readonly CanvasPropertySnapshot[] | undefined;
}

/** The selection the pieces act on: a command context with at least one selected object. */
export interface BulkSelectionProps {
  readonly commands: CanvasCommandContextValue;
}

/** Props for {@link BulkPropertiesDialog}. */
export interface BulkPropertiesDialogProps extends BulkSelectionProps, BulkActionsBarProps {}

/** The selection's actions: count, Open, Properties, Mark done, Move to trash, and history. */
export function BulkSelectionActions({ commands }: BulkSelectionProps): React.JSX.Element | null {
  const taskActions = useCanvasActions();
  const count = commands.selectedObjects.length;
  if (count === 0) return null;
  return (
    <>
      <span className="text-label-large shrink-0 px-2 whitespace-nowrap">{count} selected</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Open"
        title="Open"
        onClick={commands.openSelection}
      >
        <Folder className="size-4" /> <span className="hidden @4xl:inline">Open</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!commands.canEdit}
        aria-label="Properties"
        title="Properties"
        onClick={(event) => {
          commands.openProperties(event.currentTarget);
        }}
      >
        <TuneRounded className="size-4" /> <span className="hidden @4xl:inline">Properties</span>
      </Button>
      {commands.objectKind === 'task' && commands.canEdit && taskActions !== null && count === 1 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Mark done"
          title="Mark done"
          onClick={() => {
            const task = commands.selectedObjects[0];
            if (task !== undefined) taskActions.setComplete(task.id, true);
          }}
        >
          <CheckCircle2 className="size-4" /> <span className="hidden @4xl:inline">Mark done</span>
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!commands.canTrash || commands.pending}
        aria-label="Move to trash"
        title="Move to trash"
        onClick={commands.trashSelection}
      >
        <Trash2 className="size-4" /> <span className="hidden @4xl:inline">Move to trash</span>
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
    </>
  );
}

/** The Properties editor the selection's actions open. */
export function BulkPropertiesDialog({
  commands,
  propertySnapshots = [],
}: BulkPropertiesDialogProps): React.JSX.Element | null {
  const propertiesHeadingRef = useRef<HTMLHeadingElement>(null);
  const retainedSnapshots = useOptionalCanvasPropertySnapshots();

  const count = commands.selectedObjects.length;
  if (count === 0) return null;
  const availableSnapshots = retainedSnapshots ?? propertySnapshots;
  const selectedIds = new Set(commands.selectedObjects.map(({ id }) => id));
  const activeSnapshots = availableSnapshots.filter(
    ({ id, kind }) => selectedIds.has(id) && kind === commands.objectKind,
  );

  return (
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
        <DialogBody className="flex flex-col" inset="compact" data-testid="canvas-properties-body">
          <CanvasPropertiesEditor snapshots={activeSnapshots} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Selection actions that remain reachable without a context-menu gesture. */
export default function BulkActionsBar({
  propertySnapshots = [],
}: BulkActionsBarProps): React.JSX.Element | null {
  const commands = useCanvasCommandContext();
  if (commands === null || commands.selectedObjects.length === 0) return null;
  const count = commands.selectedObjects.length;
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
          <BulkSelectionActions commands={commands} />
        </Surface>
      </CanvasOverlayPanel>
      <BulkPropertiesDialog commands={commands} propertySnapshots={propertySnapshots} />
    </>
  );
}

/** The dialog alone, for a host whose floating bar already carries the selection's actions. */
export function BulkPropertiesDialogHost({
  propertySnapshots = [],
}: BulkActionsBarProps): React.JSX.Element | null {
  const commands = useCanvasCommandContext();
  if (commands === null) return null;
  return <BulkPropertiesDialog commands={commands} propertySnapshots={propertySnapshots} />;
}
