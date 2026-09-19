'use client';

/**
 * `components/canvas/use-canvas-receipt-applier` — fan a command receipt out to every listener.
 *
 * @remarks
 * A receipt lands in two places: the selection-retention boundary keeps retained property
 * snapshots current, and a host panel may patch its own query cache so the graph reflects the
 * change before the confirming refetch. Both graph panels call `useCanvasCommandHistory` above
 * their retention boundary, so the context applier is often absent there; this hook composes
 * whichever of the two exist into one function the history hook can call.
 */
import { useMemo } from 'react';

import type { ObjectCommandReceipt } from '../../lib/contracts/object-command';

import type { CanvasReceiptDirection } from './canvas-retained-snapshots';
import { useOptionalCanvasSnapshotReceiptApplier } from './canvas-selection-retention';

/** Something that reacts to a settled command receipt in the direction it was applied. */
export type CanvasReceiptListener = (
  receipt: ObjectCommandReceipt,
  direction: CanvasReceiptDirection,
) => void;

/**
 * Compose the retention boundary's applier with a host-supplied listener.
 *
 * @param onReceipt - A host listener, typically a query-cache patch.
 * @returns One listener, or null when neither source is present.
 */
export function useCanvasReceiptApplier(
  onReceipt: CanvasReceiptListener | undefined,
): CanvasReceiptListener | null {
  const retained = useOptionalCanvasSnapshotReceiptApplier();
  return useMemo(() => {
    if (retained === null && onReceipt === undefined) return null;
    return (receipt, direction) => {
      retained?.(receipt, direction);
      onReceipt?.(receipt, direction);
    };
  }, [onReceipt, retained]);
}
