'use client';

/** Canvas-only selection and property retention across filtered graph refreshes. */
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { SelectionProvider, useSelection } from '@/components/selection';
import { objectKey, type CanvasPropertySnapshot, type ObjectRef } from '@/lib/actions';

import {
  applyCanvasReceiptToSnapshots,
  type CanvasReceiptDirection,
} from './canvas-retained-snapshots';
import type { ObjectCommandReceipt } from '../../lib/contracts/object-command';

interface CanvasPropertySnapshotsContextValue {
  readonly snapshots: readonly CanvasPropertySnapshot[];
  readonly applyReceipt: (receipt: ObjectCommandReceipt, direction: CanvasReceiptDirection) => void;
}

const CanvasPropertySnapshotsContext = createContext<CanvasPropertySnapshotsContextValue | null>(
  null,
);

/** Props for {@link CanvasSelectionRetentionProvider}. */
export interface CanvasSelectionRetentionProviderProps {
  /** Route-and-graph scope identity. Changing it releases every retained object. */
  readonly scopeKey: string;
  /** Objects currently visible in the graph. */
  readonly items: readonly ObjectRef[];
  /** Property state currently projected by the graph. */
  readonly propertySnapshots: readonly CanvasPropertySnapshot[];
  /** Stable selection surface id. */
  readonly surfaceId: string;
  /** Workspace that owns the graph. */
  readonly organizationId: string;
  /** Canvas content. */
  readonly children: ReactNode;
}

function mergeByObjectKey<T extends { readonly kind: string; readonly id: string }>(
  current: readonly T[],
  retained: readonly T[],
): readonly T[] {
  const keys = new Set(current.map((item) => `${item.kind}:${item.id}`));
  return [...current, ...retained.filter((item) => !keys.has(`${item.kind}:${item.id}`))];
}

function sameObjects(left: readonly ObjectRef[], right: readonly ObjectRef[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (leftItem === undefined || rightItem === undefined) return false;
    if (objectKey(leftItem) !== objectKey(rightItem)) return false;
  }
  return true;
}

function sameSnapshots(
  left: readonly CanvasPropertySnapshot[],
  right: readonly CanvasPropertySnapshot[],
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function RetentionTracker({
  currentSnapshots,
  onSelection,
}: {
  readonly currentSnapshots: readonly CanvasPropertySnapshot[];
  readonly onSelection: (objects: readonly ObjectRef[]) => void;
}): null {
  const selection = useSelection();
  useEffect(() => {
    onSelection(selection.selectedObjects);
  }, [currentSnapshots, onSelection, selection.selectedObjects]);
  return null;
}

function ScopedCanvasSelectionRetention({
  items,
  propertySnapshots,
  surfaceId,
  organizationId,
  children,
}: Omit<CanvasSelectionRetentionProviderProps, 'scopeKey'>): JSX.Element {
  const [retainedObjects, setRetainedObjects] = useState<readonly ObjectRef[]>([]);
  const [retainedSnapshots, setRetainedSnapshots] = useState<readonly CanvasPropertySnapshot[]>([]);
  const selectionItems = useMemo(
    () => mergeByObjectKey(items, retainedObjects),
    [items, retainedObjects],
  );
  const availableSnapshots = useMemo(
    () => mergeByObjectKey(retainedSnapshots, propertySnapshots),
    [propertySnapshots, retainedSnapshots],
  );

  const retainSelection = useCallback(
    (objects: readonly ObjectRef[]) => {
      setRetainedObjects((current) => (sameObjects(current, objects) ? current : objects));
      setRetainedSnapshots((current) => {
        const currentByKey = new Map(
          current.map((snapshot) => [`${snapshot.kind}:${snapshot.id}`, snapshot]),
        );
        const visibleByKey = new Map(
          propertySnapshots.map((snapshot) => [`${snapshot.kind}:${snapshot.id}`, snapshot]),
        );
        const next = objects.flatMap((object) => {
          const key = objectKey(object);
          const snapshot = visibleByKey.get(key) ?? currentByKey.get(key);
          return snapshot === undefined ? [] : [snapshot];
        });
        return sameSnapshots(current, next) ? current : next;
      });
    },
    [propertySnapshots],
  );
  const applyReceipt = useCallback(
    (receipt: ObjectCommandReceipt, direction: CanvasReceiptDirection): void => {
      setRetainedSnapshots((current) => applyCanvasReceiptToSnapshots(current, receipt, direction));
    },
    [],
  );
  const snapshotContext = useMemo(
    () => ({ snapshots: availableSnapshots, applyReceipt }),
    [applyReceipt, availableSnapshots],
  );

  return (
    <SelectionProvider
      items={selectionItems}
      surfaceId={surfaceId}
      organizationId={organizationId}
      actionScope="all"
    >
      <RetentionTracker currentSnapshots={propertySnapshots} onSelection={retainSelection} />
      <CanvasPropertySnapshotsContext.Provider value={snapshotContext}>
        {children}
      </CanvasPropertySnapshotsContext.Provider>
    </SelectionProvider>
  );
}

/**
 * Preserve selected canvas objects that a command or active filter removes from the visible graph.
 *
 * @param props - Current graph objects, snapshots, and the route-and-scope identity.
 * @returns A standard selection surface with canvas-only retention layered around it.
 */
export function CanvasSelectionRetentionProvider({
  scopeKey,
  ...props
}: CanvasSelectionRetentionProviderProps): JSX.Element {
  return <ScopedCanvasSelectionRetention key={scopeKey} {...props} />;
}

/** Read the current and retained canvas property snapshots. */
export function useCanvasPropertySnapshots(): readonly CanvasPropertySnapshot[] {
  return useContext(CanvasPropertySnapshotsContext)?.snapshots ?? [];
}

/** Read retained canvas property snapshots when the canvas boundary is mounted. */
export function useOptionalCanvasPropertySnapshots(): readonly CanvasPropertySnapshot[] | null {
  return useContext(CanvasPropertySnapshotsContext)?.snapshots ?? null;
}

/** Apply a successful command receipt when the caller is mounted inside a retention boundary. */
export function useOptionalCanvasSnapshotReceiptApplier():
  CanvasPropertySnapshotsContextValue['applyReceipt'] | null {
  return useContext(CanvasPropertySnapshotsContext)?.applyReceipt ?? null;
}
