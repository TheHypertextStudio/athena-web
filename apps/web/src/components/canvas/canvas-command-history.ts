/** Pure, session-local undo and redo history for graph-canvas object commands. */
import type { ObjectCommandReceipt, ObjectCommandResult } from '@docket/types';

const HISTORY_LIMIT = 50;

/** One user-facing command stored in canvas history. */
export interface CanvasHistoryEntry {
  /** Short action name shown beside Undo and Redo. */
  readonly label: string;
  /** The server-normalized receipt that can be replayed safely. */
  readonly receipt: ObjectCommandReceipt;
}

/** The two stacks for one route and graph scope. */
export interface CanvasHistorySnapshot {
  /** Commands that can be undone, oldest first. */
  readonly undo: readonly CanvasHistoryEntry[];
  /** Commands that can be redone, oldest first. */
  readonly redo: readonly CanvasHistoryEntry[];
}

interface MutableHistory {
  undo: CanvasHistoryEntry[];
  redo: CanvasHistoryEntry[];
}

/**
 * Keep bounded command receipts apart for each mounted canvas route and scope.
 *
 * @remarks
 * The instance lives in browser memory. Nothing persists it, so a reload clears it by design.
 *
 * @param limit - Maximum receipts retained per scope.
 */
export class CanvasCommandHistory {
  private readonly byScope = new Map<string, MutableHistory>();

  constructor(private readonly limit = HISTORY_LIMIT) {}

  /** Add a successful forward command and discard that scope's stale redo branch. */
  push(scopeKey: string, entry: CanvasHistoryEntry): void {
    const history = this.mutable(scopeKey);
    history.undo.push(entry);
    if (history.undo.length > this.limit) history.undo.splice(0, history.undo.length - this.limit);
    history.redo = [];
  }

  /** Move the newest undo entry onto the redo stack and return it for replay. */
  takeUndo(scopeKey: string): CanvasHistoryEntry | null {
    const history = this.mutable(scopeKey);
    const entry = history.undo.pop() ?? null;
    if (entry !== null) history.redo.push(entry);
    return entry;
  }

  /** Move the newest redo entry back onto the undo stack and return it for replay. */
  takeRedo(scopeKey: string): CanvasHistoryEntry | null {
    const history = this.mutable(scopeKey);
    const entry = history.redo.pop() ?? null;
    if (entry !== null) history.undo.push(entry);
    return entry;
  }

  /** Replace the receipt at the top of a stack after a partial replay. */
  replaceTop(scopeKey: string, stack: 'undo' | 'redo', entry: CanvasHistoryEntry | null): void {
    const target = this.mutable(scopeKey)[stack];
    target.pop();
    if (entry !== null && entry.receipt.entries.length > 0) target.push(entry);
  }

  /** Put an entry back when a network replay failed before the server accepted it. */
  restoreFailedReplay(
    scopeKey: string,
    direction: 'undo' | 'redo',
    entry: CanvasHistoryEntry,
  ): void {
    const history = this.mutable(scopeKey);
    if (direction === 'undo') {
      history.redo.pop();
      history.undo.push(entry);
    } else {
      history.undo.pop();
      history.redo.push(entry);
    }
  }

  /** Read immutable copies for rendering action names and disabled states. */
  snapshot(scopeKey: string): CanvasHistorySnapshot {
    const history = this.mutable(scopeKey);
    return { undo: [...history.undo], redo: [...history.redo] };
  }

  private mutable(scopeKey: string): MutableHistory {
    const existing = this.byScope.get(scopeKey);
    if (existing !== undefined) return existing;
    const created: MutableHistory = { undo: [], redo: [] };
    this.byScope.set(scopeKey, created);
    return created;
  }
}

/** Use the server's successful replay subset as the only receipt eligible for the opposite action. */
export function narrowReceiptToResult(
  _original: ObjectCommandReceipt,
  result: ObjectCommandResult,
): ObjectCommandReceipt {
  return result.receipt;
}
