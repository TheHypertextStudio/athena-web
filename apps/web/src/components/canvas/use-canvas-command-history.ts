'use client';

/** Object-command client plus session-local, conflict-safe canvas undo and redo. */
import type { ObjectCommandIn, ObjectCommandRequest, ObjectCommandResult } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';

import {
  CanvasCommandHistory,
  type CanvasHistoryEntry,
  narrowReceiptToResult,
} from './canvas-command-history';
import { useOptionalCanvasSnapshotReceiptApplier } from './canvas-selection-retention';

const commandHistory = new CanvasCommandHistory();

/** Transient application-owned feedback shown over a canvas. */
export interface CanvasCommandNotice {
  /** Safe status or failure copy. */
  readonly copy: string;
  /** Whether the current notice should expose an Undo action. */
  readonly offerUndo: boolean;
  /** Whether assistive technology should announce this as a failure. */
  readonly tone: 'status' | 'error';
}

/** Controls exposed to canvas menus, selection bars, and keyboard handlers. */
export interface CanvasCommandHistoryControls {
  /** Apply one atomic forward command and store its receipt. */
  readonly execute: (
    command: ObjectCommandIn,
    label: string,
  ) => Promise<ObjectCommandResult | null>;
  /** Undo the newest receipt in this route and scope. */
  readonly undo: () => Promise<void>;
  /** Redo the newest successfully undone receipt in this route and scope. */
  readonly redo: () => Promise<void>;
  /** Whether Undo is available. */
  readonly canUndo: boolean;
  /** Whether Redo is available. */
  readonly canRedo: boolean;
  /** The action Undo will affect. */
  readonly undoLabel: string | null;
  /** The action Redo will affect. */
  readonly redoLabel: string | null;
  /** Whether a command is in flight. */
  readonly pending: boolean;
  /** Current app-owned result notice. */
  readonly notice: CanvasCommandNotice | null;
  /** Dismiss the result notice. */
  readonly clearNotice: () => void;
}

/** Build an id that can safely serve as both command identity and idempotency key. */
export function canvasCommandId(): string {
  return crypto.randomUUID();
}

/** Decide whether a completed forward command needs an inline Undo shortcut. */
function shouldOfferNoticeUndo(command: ObjectCommandIn): boolean {
  if (command.operation.type === 'trash') return true;
  if (command.objectIds.length < 2) return false;
  return ['replace_property', 'add_association', 'remove_association'].includes(
    command.operation.type,
  );
}

/**
 * Bind the typed object-command endpoint to one graph route and scope.
 *
 * @param orgId - Workspace that owns every command.
 * @param scopeKey - Stable route-and-scope history boundary.
 * @param invalidateKeys - Graph query keys reconciled after each request.
 * @returns Command, replay, keyboard, history-label, and notice controls.
 */
export function useCanvasCommandHistory(
  orgId: string,
  scopeKey: string,
  invalidateKeys: readonly QueryKey[],
): CanvasCommandHistoryControls {
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<CanvasCommandNotice | null>(null);
  const replayInFlight = useRef(false);
  const applyReceipt = useOptionalCanvasSnapshotReceiptApplier();
  const mutation = useApiMutation<ObjectCommandResult, ObjectCommandRequest>({
    mutationFn: (request) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['object-commands'].$post(
            { param: { orgId }, json: request },
            { headers: { 'Idempotency-Key': request.commandId } },
          ),
        'Could not apply this change.',
      ),
    invalidateKeys,
  });
  const refresh = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const execute = useCallback(
    async (command: ObjectCommandIn, label: string): Promise<ObjectCommandResult | null> => {
      setNotice(null);
      try {
        const result = await mutation.mutateAsync(command);
        applyReceipt?.(result.receipt, 'forward');
        const storedReceipt = result.receipt.entries.length > 0;
        if (storedReceipt) {
          commandHistory.push(scopeKey, { label, receipt: result.receipt });
          refresh();
        }
        setNotice({
          copy: `${label} applied.`,
          offerUndo: storedReceipt && shouldOfferNoticeUndo(command),
          tone: 'status',
        });
        return result;
      } catch {
        setNotice({
          copy: 'Could not apply this change. Your selection was kept.',
          offerUndo: false,
          tone: 'error',
        });
        return null;
      }
    },
    [applyReceipt, mutation, refresh, scopeKey],
  );

  const replay = useCallback(
    async (direction: 'undo' | 'redo'): Promise<void> => {
      if (replayInFlight.current) return;
      const entry =
        direction === 'undo'
          ? commandHistory.takeUndo(scopeKey)
          : commandHistory.takeRedo(scopeKey);
      if (entry === null) return;
      replayInFlight.current = true;
      setNotice(null);
      refresh();
      const destination = direction === 'undo' ? 'redo' : 'undo';
      try {
        const result = await mutation.mutateAsync({
          commandId: canvasCommandId(),
          direction,
          receipt: entry.receipt,
        });
        const narrowed = narrowReceiptToResult(entry.receipt, result);
        applyReceipt?.(narrowed, direction);
        commandHistory.replaceTop(
          scopeKey,
          destination,
          narrowed.entries.length === 0 ? null : { ...entry, receipt: narrowed },
        );
        const skipped = result.conflictingIds.length + result.deniedIds.length;
        setNotice({
          copy:
            skipped === 0
              ? `${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label.toLowerCase()}.`
              : `${direction === 'undo' ? 'Undid' : 'Redid'} ${String(result.appliedIds.length)} items. ${String(skipped)} items changed elsewhere or no longer allow this action.`,
          offerUndo: false,
          tone: 'status',
        });
      } catch {
        // Put the untouched entry back on its original stack. The replay did not succeed, so the
        // opposite action must not become available over a receipt the server never applied.
        commandHistory.restoreFailedReplay(scopeKey, direction, entry);
        setNotice({
          copy: `Could not ${direction} ${entry.label.toLowerCase()}. No collaborator changes were overwritten.`,
          offerUndo: false,
          tone: 'error',
        });
      } finally {
        replayInFlight.current = false;
        refresh();
      }
    },
    [applyReceipt, mutation, refresh, scopeKey],
  );

  const undo = useCallback(() => replay('undo'), [replay]);
  const redo = useCallback(() => replay('redo'), [replay]);

  const snapshot = useMemo(() => commandHistory.snapshot(scopeKey), [scopeKey, version]);
  const newest = (entries: readonly CanvasHistoryEntry[]): CanvasHistoryEntry | undefined =>
    entries.at(-1);
  return {
    execute,
    undo,
    redo,
    canUndo: snapshot.undo.length > 0,
    canRedo: snapshot.redo.length > 0,
    undoLabel: newest(snapshot.undo)?.label ?? null,
    redoLabel: newest(snapshot.redo)?.label ?? null,
    pending: mutation.isPending || replayInFlight.current,
    notice,
    clearNotice: () => {
      setNotice(null);
    },
  };
}
