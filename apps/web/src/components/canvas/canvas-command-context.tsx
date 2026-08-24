'use client';

/** Shared Project and Task canvas command, history, trash, and selection action surface. */
import type { ObjectCommandIn } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { useSelection } from '@/components/selection';
import type { ObjectKind, ObjectRef } from '@/lib/actions';

import { isCanvasEditableTarget, resolveCanvasHistoryShortcut } from './canvas-keyboard';
import {
  canvasCommandId,
  type CanvasCommandHistoryControls,
  useCanvasCommandHistory,
} from './use-canvas-command-history';

/** Commands a pane menu and floating selection bar can invoke without right-click. */
export interface CanvasCommandContextValue extends CanvasCommandHistoryControls {
  /** The homogeneous kind rendered by this canvas. */
  readonly objectKind: 'task' | 'project';
  /** Whether mutation controls should be enabled. */
  readonly canEdit: boolean;
  /** Whether recoverable trash is allowed for this object kind. */
  readonly canTrash: boolean;
  /** Objects selected in the shared selection provider. */
  readonly selectedObjects: readonly ObjectRef[];
  /** Open the matching same-workspace composer. */
  readonly createObject: () => void;
  /** Open or peek the current primary selection. */
  readonly openSelection: () => void;
  /** Open or peek a specific context target without replacing the current selection. */
  readonly openObject: (objectId: string) => void;
  /** Open the shared bulk-properties shell. */
  readonly openProperties: (invoker?: HTMLElement | null) => void;
  /** Whether the shared bulk-properties editor is open. */
  readonly propertiesOpen: boolean;
  /** Close Properties and restore focus to the invoking control when it still exists. */
  readonly closeProperties: () => void;
  /** Request recoverable trash, with confirmation when risk warrants it. */
  readonly trashSelection: () => void;
  /** Keyboard handler for Delete and Backspace while the canvas owns focus. */
  readonly onCanvasKeyDown: (event: React.KeyboardEvent) => void;
}

const CanvasCommandContext = createContext<CanvasCommandContextValue | null>(null);

/** Props for {@link CanvasCommandProvider}. */
export interface CanvasCommandProviderProps {
  /** Workspace that owns the graph. */
  readonly orgId: string;
  /** Stable route and graph-scope history key. */
  readonly scopeKey: string;
  /** Homogeneous object kind in this canvas. */
  readonly objectKind: 'task' | 'project';
  /** Whether writes are allowed. */
  readonly canEdit: boolean;
  /** Whether recoverable trash is allowed. Defaults to `canEdit`. */
  readonly canTrash?: boolean | undefined;
  /** Query keys that commands invalidate. */
  readonly invalidateKeys: readonly QueryKey[];
  /** Launch same-workspace creation. */
  readonly onCreateObject: () => void;
  /** Open the selected object. */
  readonly onOpenObject: (object: ObjectRef) => void;
  /** Observe the selected objects when the shared Properties editor opens. */
  readonly onOpenProperties?: ((objects: readonly ObjectRef[]) => void) | undefined;
  /** Canvas content and overlays. */
  readonly children: ReactNode;
}

/** Props for a provider whose host owns the one route-scoped history instance. */
export interface CanvasCommandProviderWithHistoryProps extends Omit<
  CanvasCommandProviderProps,
  'orgId' | 'scopeKey' | 'invalidateKeys'
> {
  /** Command controls shared by panel mutations, menus, selection actions, and keyboard replay. */
  readonly history: CanvasCommandHistoryControls;
}

/** Confirmation copy required before a risky recoverable trash command. */
export interface CanvasTrashConfirmation {
  readonly objects: readonly ObjectRef[];
  readonly title: string;
  readonly description: string;
}

/** Count selected objects by kind so mixed future canvases can reuse confirmation copy. */
export function canvasSelectionCounts(
  objects: readonly ObjectRef[],
): ReadonlyMap<ObjectKind, number> {
  const counts = new Map<ObjectKind, number>();
  for (const object of objects) counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
  return counts;
}

/** Render readable multi-object trash counts. */
export function describeCanvasSelectionCounts(objects: readonly ObjectRef[]): string {
  const counts = canvasSelectionCounts(objects);
  return [...counts.entries()]
    .map(([kind, count]) => `${String(count)} ${kind}${count === 1 ? '' : 's'}`)
    .join(' and ');
}

/** Return confirmation copy for nonempty Projects and multi-object selections. */
export function canvasTrashConfirmation(
  objects: readonly ObjectRef[],
): CanvasTrashConfirmation | null {
  if (objects.length > 1) {
    return {
      objects,
      title: `Move ${describeCanvasSelectionCounts(objects)} to trash?`,
      description:
        'Their relationships stay linked, so restoring the items restores the same graph structure.',
    };
  }
  const object = objects[0];
  if (object?.kind !== 'project') return null;
  const taskCount = Number(object.meta?.['taskCount'] ?? 0);
  if (taskCount === 0) return null;
  return {
    objects,
    title: `Move ${object.title} to trash?`,
    description: `${String(taskCount)} ${taskCount === 1 ? 'Task remains' : 'Tasks remain'} linked to this Project. Restoring the Project restores its place in the graph and keeps those relationships.`,
  };
}

/** Provide shared command behavior beneath an existing {@link import('../selection').SelectionProvider}. */
export function CanvasCommandProvider({
  orgId,
  scopeKey,
  invalidateKeys,
  ...props
}: CanvasCommandProviderProps): JSX.Element {
  const history = useCanvasCommandHistory(orgId, scopeKey, invalidateKeys);
  return <CanvasCommandProviderWithHistory {...props} history={history} />;
}

/** Provide canvas actions from the same history instance that panel gestures execute through. */
export function CanvasCommandProviderWithHistory({
  objectKind,
  canEdit,
  canTrash = canEdit,
  onCreateObject,
  onOpenObject,
  onOpenProperties,
  history,
  children,
}: CanvasCommandProviderWithHistoryProps): JSX.Element {
  const selection = useSelection();
  const [pendingTrash, setPendingTrash] = useState<CanvasTrashConfirmation | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const propertiesInvokerRef = useRef<HTMLElement | null>(null);

  const openProperties = useCallback(
    (invoker?: HTMLElement | null): void => {
      propertiesInvokerRef.current =
        invoker ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setPropertiesOpen(true);
      onOpenProperties?.(selection.selectedObjects);
    },
    [onOpenProperties, selection.selectedObjects],
  );
  const closeProperties = useCallback((): void => {
    setPropertiesOpen(false);
    const invoker = propertiesInvokerRef.current;
    propertiesInvokerRef.current = null;
    queueMicrotask(() => {
      if (invoker?.isConnected) invoker.focus();
    });
  }, []);

  useEffect(() => {
    if (selection.count !== 0) return;
    setPropertiesOpen(false);
    propertiesInvokerRef.current = null;
  }, [selection.count]);

  const applyTrash = useCallback(
    async (objects: readonly ObjectRef[]): Promise<void> => {
      if (!canTrash || objects.length === 0) return;
      const command: ObjectCommandIn = {
        commandId: canvasCommandId(),
        objectKind,
        objectIds: objects.map(({ id }) => id),
        operation: { type: 'trash' },
      } as ObjectCommandIn;
      const result = await history.execute(
        command,
        `Move ${objects.length === 1 ? (objects[0]?.title ?? objectKind) : describeCanvasSelectionCounts(objects)} to trash`,
      );
      if (result !== null) setPendingTrash(null);
    },
    [canTrash, history, objectKind],
  );

  const trashSelection = useCallback(() => {
    const objects = selection.selectedObjects.filter(({ kind }) => kind === objectKind);
    if (!canTrash || objects.length === 0) return;
    const confirmation = canvasTrashConfirmation(objects);
    if (confirmation !== null) {
      setPendingTrash(confirmation);
      return;
    }
    void applyTrash(objects);
  }, [applyTrash, canTrash, objectKind, selection.selectedObjects]);

  const onCanvasKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (isCanvasEditableTarget(event.target)) return;
      const historyAction = resolveCanvasHistoryShortcut(event.nativeEvent);
      if (historyAction !== null) {
        if (!canEdit) return;
        const available = historyAction === 'undo' ? history.canUndo : history.canRedo;
        if (!available || history.pending) return;
        event.preventDefault();
        void (historyAction === 'undo' ? history.undo() : history.redo());
        return;
      }
      if (!canTrash) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (selection.count === 0) return;
      event.preventDefault();
      trashSelection();
    },
    [canEdit, canTrash, history, selection.count, trashSelection],
  );

  const value = useMemo<CanvasCommandContextValue>(
    () => ({
      ...history,
      canUndo: canEdit && history.canUndo,
      canRedo: canEdit && history.canRedo,
      undo: async () => {
        if (canEdit) await history.undo();
      },
      redo: async () => {
        if (canEdit) await history.redo();
      },
      objectKind,
      canEdit,
      canTrash,
      selectedObjects: selection.selectedObjects,
      createObject: onCreateObject,
      openObject: (objectId) => {
        const object = selection.items.find(
          ({ id, kind }) => id === objectId && kind === objectKind,
        );
        if (object !== undefined) onOpenObject(object);
      },
      openSelection: () => {
        const object = selection.selectedObjects.at(-1);
        if (object !== undefined) onOpenObject(object);
      },
      openProperties,
      propertiesOpen,
      closeProperties,
      trashSelection,
      onCanvasKeyDown,
    }),
    [
      canEdit,
      canTrash,
      history,
      objectKind,
      onCanvasKeyDown,
      onCreateObject,
      onOpenObject,
      openProperties,
      propertiesOpen,
      closeProperties,
      selection.selectedObjects,
      trashSelection,
    ],
  );

  return (
    <CanvasCommandContext.Provider value={value}>
      {children}
      <ConfirmDestructiveDialog
        open={pendingTrash !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTrash(null);
        }}
        title={pendingTrash?.title ?? 'Move selection to trash?'}
        description={
          pendingTrash?.description ??
          'Relationships stay linked, so restoring the items restores the same graph structure.'
        }
        confirmLabel="Move to trash"
        pending={history.pending}
        error={history.notice?.tone === 'error' ? history.notice.copy : null}
        onConfirm={() => {
          if (pendingTrash !== null) void applyTrash(pendingTrash.objects);
        }}
      />
    </CanvasCommandContext.Provider>
  );
}

/** Read shared command controls from an editable Project or Task canvas. */
export function useCanvasCommandContext(): CanvasCommandContextValue | null {
  return useContext(CanvasCommandContext);
}
