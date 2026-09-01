'use client';

/** Object-command client plus session-local, conflict-safe canvas undo and redo. */
import type {
  ObjectCommandIn,
  ObjectCommandReplayAccessResult,
  ObjectCommandRequest,
  ObjectCommandResult,
} from '../../lib/contracts/object-command';
import type { QueryKey } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import {
  CanvasCommandHistory,
  type CanvasHistoryEntry,
  narrowReceiptToResult,
} from './canvas-command-history';
import { useOptionalCanvasSnapshotReceiptApplier } from './canvas-selection-retention';

const commandHistory = new CanvasCommandHistory();

/** Transient application-owned feedback shown over a canvas. */
export interface CanvasCommandNotice {
  /** Short result that names what changed. */
  readonly title: string;
  /** One-line explanation that names the affected work and outcome. */
  readonly detail: string;
  /** Whether the current notice should expose an Undo action. */
  readonly offerUndo: boolean;
  /** Whether assistive technology should announce this as a failure. */
  readonly tone: 'status' | 'error';
}

/** User-facing result copy and the related Undo history label for one command. */
export interface CanvasCommandFeedback {
  /** Imperative action name used by Undo and Redo menus. */
  readonly historyLabel: string;
  /** Short result that names what changed. */
  readonly title: string;
  /** One-line explanation that names the affected work and outcome. */
  readonly detail: string;
  /** Short result shown when the server reports that the requested state already existed. */
  readonly unchangedTitle: string;
  /** Explicit current state shown when the server reports no receipt entries. */
  readonly unchangedDetail: string;
}

/** Controls exposed to canvas menus, selection bars, and keyboard handlers. */
export interface CanvasCommandHistoryControls {
  /** Apply one atomic forward command and store its receipt. */
  readonly execute: (
    command: ObjectCommandIn,
    feedback: CanvasCommandFeedback,
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

function replayActionName(entry: CanvasHistoryEntry): string {
  const [verb, ...rest] = entry.label.split(' ');
  const subject = rest.join(' ').toLowerCase();
  const phrase = (() => {
    switch (verb) {
      case 'Add':
        return `${subject} addition`;
      case 'Remove':
        return `${subject} removal`;
      case 'Change':
        return `${subject} change`;
      case 'Complete':
        return `${subject} completion`;
      case 'Mark':
        return subject.endsWith(' done')
          ? `${subject.slice(0, -' done'.length)} completion`
          : `${subject} update`;
      case 'Reopen':
        return `${subject} reopening`;
      case 'Move':
        return `${subject} move`;
      case 'Restore':
        return `${subject} restoration`;
      default:
        return entry.label.toLowerCase();
    }
  })();
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function replayNoticeTitle(entry: CanvasHistoryEntry, direction: 'undo' | 'redo'): string {
  if (entry.receipt.action === 'trash') {
    return direction === 'undo' ? 'Restored from trash' : 'Moved to trash again';
  }
  return `${replayActionName(entry)} ${direction === 'undo' ? 'undone' : 'restored'}`;
}

function replayFailureTitle(entry: CanvasHistoryEntry, direction: 'undo' | 'redo'): string {
  return `${replayActionName(entry)} was not ${direction === 'undo' ? 'undone' : 'restored'}`;
}

function replayNoticeDetail(
  entry: CanvasHistoryEntry,
  direction: 'undo' | 'redo',
  result: ObjectCommandResult,
): string {
  const changed = result.appliedIds.length;
  const skipped = result.conflictingIds.length + result.deniedIds.length;
  const noun = entry.receipt.objectKind === 'task' ? 'task' : 'project';
  const objects = `${String(changed)} ${noun}${changed === 1 ? '' : 's'}`;
  if (skipped > 0) {
    return `${objects} updated and ${String(skipped)} skipped after state or access changes`;
  }
  if (entry.receipt.action === 'add_dependency' || entry.receipt.action === 'remove_dependency') {
    return direction === 'undo'
      ? 'The dependency returned to its previous state'
      : 'The dependency was updated again';
  }
  if (entry.receipt.action === 'trash') {
    return direction === 'undo' ? `${objects} active again` : `${objects} in trash again`;
  }
  return direction === 'undo'
    ? `${objects} returned to the previous state`
    : `${objects} received the update again`;
}

function replayAccessDef(
  orgId: string,
  scopeKey: string,
  direction: 'undo' | 'redo',
  receipt: CanvasHistoryEntry['receipt'] | null,
) {
  return apiQueryOptions<ObjectCommandReplayAccessResult>(
    ['org', orgId, 'canvas-command-replay-access', scopeKey, direction, receipt],
    () => {
      if (receipt === null) throw new Error('Replay access requested without a receipt');
      return api.v1.orgs[':orgId']['object-commands']['replay-access'].$post({
        param: { orgId },
        json: { direction, receipt },
      });
    },
    'Could not check whether this action is still allowed.',
    { enabled: receipt !== null, staleTime: 0 },
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
  const snapshot = useMemo(() => commandHistory.snapshot(scopeKey), [scopeKey, version]);
  const newestUndo = snapshot.undo.at(-1);
  const newestRedo = snapshot.redo.at(-1);
  const undoReceipt = newestUndo?.receipt ?? null;
  const redoReceipt = newestRedo?.receipt ?? null;
  const undoAccess = useApiQuery(replayAccessDef(orgId, scopeKey, 'undo', undoReceipt));
  const redoAccess = useApiQuery(replayAccessDef(orgId, scopeKey, 'redo', redoReceipt));

  const execute = useCallback(
    async (
      command: ObjectCommandIn,
      feedback: CanvasCommandFeedback,
    ): Promise<ObjectCommandResult | null> => {
      setNotice(null);
      try {
        const result = await mutation.mutateAsync(command);
        applyReceipt?.(result.receipt, 'forward');
        const storedReceipt = result.receipt.entries.length > 0;
        if (storedReceipt) {
          commandHistory.push(scopeKey, { label: feedback.historyLabel, receipt: result.receipt });
          refresh();
        }
        setNotice({
          title: storedReceipt ? feedback.title : feedback.unchangedTitle,
          detail: storedReceipt ? feedback.detail : feedback.unchangedDetail,
          offerUndo: storedReceipt && shouldOfferNoticeUndo(command),
          tone: 'status',
        });
        return result;
      } catch {
        setNotice({
          title: 'Change failed',
          detail: 'Your selection was kept',
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
      const currentSnapshot = commandHistory.snapshot(scopeKey);
      const entry = (direction === 'undo' ? currentSnapshot.undo : currentSnapshot.redo).at(-1);
      if (entry === undefined) return;
      const renderedEntry = direction === 'undo' ? newestUndo : newestRedo;
      if (entry !== renderedEntry) {
        refresh();
        return;
      }
      replayInFlight.current = true;
      setNotice(null);
      refresh();
      let accessAllowed = false;
      try {
        const checked = await (direction === 'undo' ? undoAccess : redoAccess).refetch({
          throwOnError: true,
        });
        accessAllowed = checked.data?.allowed === true;
      } catch {
        setNotice({
          title: replayFailureTitle(entry, direction),
          detail: 'No collaborator changes were overwritten',
          offerUndo: false,
          tone: 'error',
        });
      }
      if (!accessAllowed) {
        replayInFlight.current = false;
        refresh();
        return;
      }
      const latestSnapshot = commandHistory.snapshot(scopeKey);
      const latest = (direction === 'undo' ? latestSnapshot.undo : latestSnapshot.redo).at(-1);
      if (latest !== entry) {
        replayInFlight.current = false;
        refresh();
        return;
      }
      const taken =
        direction === 'undo'
          ? commandHistory.takeUndo(scopeKey)
          : commandHistory.takeRedo(scopeKey);
      if (taken !== entry) {
        replayInFlight.current = false;
        refresh();
        return;
      }
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
        setNotice({
          title: replayNoticeTitle(entry, direction),
          detail: replayNoticeDetail(entry, direction, result),
          offerUndo: false,
          tone: 'status',
        });
      } catch {
        // Put the untouched entry back on its original stack. The replay did not succeed, so the
        // opposite action must not become available over a receipt the server never applied.
        commandHistory.restoreFailedReplay(scopeKey, direction, entry);
        setNotice({
          title: replayFailureTitle(entry, direction),
          detail: 'No collaborator changes were overwritten',
          offerUndo: false,
          tone: 'error',
        });
      } finally {
        replayInFlight.current = false;
        refresh();
      }
    },
    [applyReceipt, mutation, newestRedo, newestUndo, redoAccess, refresh, scopeKey, undoAccess],
  );

  const undo = useCallback(() => replay('undo'), [replay]);
  const redo = useCallback(() => replay('redo'), [replay]);

  return {
    execute,
    undo,
    redo,
    canUndo:
      newestUndo !== undefined &&
      !undoAccess.isFetching &&
      !undoAccess.isError &&
      undoAccess.data?.allowed === true,
    canRedo:
      newestRedo !== undefined &&
      !redoAccess.isFetching &&
      !redoAccess.isError &&
      redoAccess.data?.allowed === true,
    undoLabel: newestUndo?.label ?? null,
    redoLabel: newestRedo?.label ?? null,
    pending: mutation.isPending || replayInFlight.current,
    notice,
    clearNotice: () => {
      setNotice(null);
    },
  };
}
