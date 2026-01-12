/**
 * History Panel
 *
 * Side sheet component for browsing and managing undo/redo history.
 * Allows users to jump to any point in their action history.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { cn } from '@/lib/utils';
import { useUndo } from '@/lib/undo';
import { isUndoBatch, type UndoStackItem } from '@/lib/undo';
import { Button } from './button';

/**
 * Format a timestamp for display.
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Get operation icon/indicator.
 */
function getOperationIndicator(item: UndoStackItem): string {
  if (isUndoBatch(item)) {
    return 'batch';
  }
  switch (item.operationType) {
    case 'create':
      return 'create';
    case 'update':
      return 'update';
    case 'delete':
      return 'delete';
    default:
      return 'update';
  }
}

/**
 * History Panel component.
 *
 * Slides in from the right side of the screen, showing all actions
 * that can be undone. Clicking an item undoes back to that point.
 */
export function HistoryPanel() {
  const { history, undoTo, clearHistory, isHistoryOpen, closeHistory, isProcessing } = useUndo();

  const handleItemClick = useCallback(
    async (itemId: string) => {
      await undoTo(itemId);
    },
    [undoTo],
  );

  const handleClearHistory = useCallback(() => {
    clearHistory();
    closeHistory();
  }, [clearHistory, closeHistory]);

  if (typeof window === 'undefined') return null;
  if (!isHistoryOpen) return null;

  // Reverse history so most recent is at top
  const reversedHistory = [...history].reverse();

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'bg-inverse-surface/40 fixed inset-0 z-50',
          'animate-in fade-in-0 duration-200',
        )}
        onClick={closeHistory}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-labelledby="history-panel-title"
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-full max-w-sm',
          'bg-surface-container-high shadow-xl',
          'animate-in slide-in-from-right duration-300 ease-out',
          'flex flex-col',
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <HistoryIcon className="text-on-surface-variant" sx={{ fontSize: 24 }} />
            <h2 id="history-panel-title" className="text-title-large text-on-surface">
              History
            </h2>
          </div>
          <button
            onClick={closeHistory}
            className="hover:bg-on-surface/8 rounded-full p-2 transition-colors"
            aria-label="Close history"
          >
            <CloseIcon sx={{ fontSize: 20 }} className="text-on-surface-variant" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {reversedHistory.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <HistoryIcon sx={{ fontSize: 48 }} className="text-on-surface-variant/50" />
              <p className="text-body-large text-on-surface-variant">No actions yet</p>
              <p className="text-body-medium text-on-surface-variant/70">
                Actions you perform will appear here so you can undo them.
              </p>
            </div>
          ) : (
            <ul className="py-2">
              {reversedHistory.map((item, index) => {
                const operation = getOperationIndicator(item);
                const isFirst = index === 0;

                return (
                  <li key={item.id}>
                    <button
                      onClick={() => void handleItemClick(item.id)}
                      disabled={isProcessing}
                      className={cn(
                        'w-full px-4 py-3 text-left',
                        'flex items-start gap-3',
                        'hover:bg-on-surface/8 active:bg-on-surface/12',
                        'transition-colors duration-100',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      {/* Timeline indicator */}
                      <div className="flex shrink-0 flex-col items-center pt-0.5">
                        <div
                          className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            isFirst
                              ? 'bg-primary'
                              : operation === 'create'
                                ? 'bg-tertiary'
                                : operation === 'delete'
                                  ? 'bg-error'
                                  : 'bg-on-surface-variant/50',
                          )}
                        />
                        {index < reversedHistory.length - 1 && (
                          <div className="bg-outline-variant mt-1 h-8 w-px" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'text-body-medium truncate',
                            isFirst ? 'text-on-surface' : 'text-on-surface-variant',
                          )}
                        >
                          {item.description}
                        </p>
                        <p className="text-label-small text-on-surface-variant/70 mt-0.5">
                          {formatTime(item.timestamp)}
                          {isUndoBatch(item) && ` (${String(item.commands.length)} actions)`}
                        </p>
                      </div>

                      {/* First item indicator */}
                      {isFirst && (
                        <span className="text-label-small text-primary shrink-0">Latest</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {reversedHistory.length > 0 && (
          <div className="bg-surface-container shrink-0 px-4 py-3">
            <Button
              variant="text"
              size="sm"
              onClick={handleClearHistory}
              disabled={isProcessing}
              className="text-on-surface-variant hover:text-error w-full"
            >
              <DeleteSweepIcon sx={{ fontSize: 18 }} className="mr-2" />
              Clear history
            </Button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
