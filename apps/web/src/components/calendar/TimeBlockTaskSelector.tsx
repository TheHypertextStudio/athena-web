/**
 * Task selector for adding tasks to time blocks.
 *
 * Displays a searchable list of incomplete tasks as an anchored popover.
 * Follows HIG principles: appears from anchor point with spatial continuity.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/api-client';

// =============================================================================
// Types
// =============================================================================

export interface TimeBlockTaskSelectorProps {
  /** Whether the selector is open */
  open: boolean;
  /** Available tasks to select from */
  tasks: Task[];
  /** IDs of tasks already linked to the time block */
  linkedTaskIds: string[];
  /** Whether tasks are loading */
  isLoading?: boolean;
  /** Anchor rect for positioning (from "Add Task" button) */
  anchorRect: DOMRect | null;
  /** Callback when selector should close */
  onClose: () => void;
  /** Callback when a task is selected */
  onSelect: (taskId: string) => Promise<void>;
}

interface PopoverPosition {
  top: number;
  left: number;
  placement: 'right' | 'left' | 'below';
}

// =============================================================================
// Constants
// =============================================================================

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 360;
const POPOVER_GAP = 8;
const VIEWPORT_PADDING = 16;

// =============================================================================
// Helpers
// =============================================================================

function calculatePosition(anchorRect: DOMRect): PopoverPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Try to place to the right first
  let left = anchorRect.right + POPOVER_GAP;
  let placement: PopoverPosition['placement'] = 'right';

  // If doesn't fit on right, try left
  if (left + POPOVER_WIDTH + VIEWPORT_PADDING > viewportWidth) {
    left = anchorRect.left - POPOVER_WIDTH - POPOVER_GAP;
    placement = 'left';
  }

  // If doesn't fit on left either, place below
  if (left < VIEWPORT_PADDING) {
    left = Math.max(VIEWPORT_PADDING, anchorRect.left);
    placement = 'below';
  }

  // Calculate top position
  let top: number;
  if (placement === 'below') {
    top = anchorRect.bottom + POPOVER_GAP;
  } else {
    // Center vertically relative to anchor
    top = anchorRect.top - POPOVER_HEIGHT / 2 + anchorRect.height / 2;
  }

  // Keep in viewport vertically
  if (top < VIEWPORT_PADDING) {
    top = VIEWPORT_PADDING;
  }
  if (top + POPOVER_HEIGHT + VIEWPORT_PADDING > viewportHeight) {
    top = viewportHeight - POPOVER_HEIGHT - VIEWPORT_PADDING;
  }

  // Keep in viewport horizontally
  if (left + POPOVER_WIDTH + VIEWPORT_PADDING > viewportWidth) {
    left = viewportWidth - POPOVER_WIDTH - VIEWPORT_PADDING;
  }

  return { top, left, placement };
}

// =============================================================================
// Helper Components
// =============================================================================

/** Priority indicator dot */
function PriorityDot({ priority }: { priority?: Task['priority'] }) {
  const colors: Record<NonNullable<Task['priority']>, string> = {
    urgent: 'bg-error',
    high: 'bg-warning',
    medium: 'bg-primary',
    low: 'bg-outline-variant',
  };
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', colors[priority ?? 'medium'])} />;
}

/** Selectable task row */
function SelectableTaskRow({
  task,
  isLinked,
  onSelect,
}: {
  task: Task;
  isLinked: boolean;
  onSelect: () => Promise<void>;
}) {
  const [isAdding, setIsAdding] = useState(false);

  const handleClick = async () => {
    if (isLinked || isAdding) return;
    setIsAdding(true);
    try {
      await onSelect();
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleClick();
      }}
      disabled={isLinked || isAdding}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
        'transition-colors duration-150',
        isLinked
          ? 'bg-primary/10 cursor-default'
          : 'hover:bg-surface-container-high cursor-pointer',
        isAdding && 'opacity-50',
      )}
    >
      <div
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
          'transition-colors duration-150',
          isLinked
            ? 'border-primary bg-primary'
            : 'border-outline-variant group-hover:border-primary',
        )}
      >
        {isLinked && <CheckOutlined sx={{ fontSize: 10 }} className="text-white" />}
        {isAdding && <SyncOutlined sx={{ fontSize: 10 }} className="animate-spin" />}
      </div>
      <PriorityDot priority={task.priority} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-on-surface truncate text-sm', isLinked && 'text-primary')}>
          {task.title}
        </p>
      </div>
      {task.estimatedMinutes && (
        <span className="text-on-surface-variant shrink-0 text-xs">{task.estimatedMinutes}m</span>
      )}
    </button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Anchored popover for selecting tasks to add to a time block.
 */
export const TimeBlockTaskSelector = memo(function TimeBlockTaskSelector({
  open,
  tasks,
  linkedTaskIds,
  isLoading = false,
  anchorRect,
  onClose,
  onSelect,
}: TimeBlockTaskSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  // SSR safety: only render portal after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Calculate position
  const position = useMemo(() => {
    if (!anchorRect) return null;
    return calculatePosition(anchorRect);
  }, [anchorRect]);

  // Reset search and focus when opened
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // Close on escape
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popoverRef.current?.contains(target)) {
        return;
      }
      onClose();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  // Filter tasks: show incomplete tasks only, filter by search query
  const filteredTasks = useMemo(() => {
    const incompleteTasks = tasks.filter(
      (t) => t.status !== 'completed' && t.status !== 'cancelled',
    );

    if (!searchQuery.trim()) {
      return incompleteTasks;
    }

    const query = searchQuery.toLowerCase();
    return incompleteTasks.filter((t) => t.title.toLowerCase().includes(query));
  }, [tasks, searchQuery]);

  // Sort: unlinked tasks first, then by priority
  const sortedTasks = useMemo(() => {
    const priorityOrder: Record<NonNullable<Task['priority']>, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return [...filteredTasks].sort((a, b) => {
      // Linked tasks go to the bottom
      const aLinked = linkedTaskIds.includes(a.id);
      const bLinked = linkedTaskIds.includes(b.id);
      if (aLinked !== bLinked) return aLinked ? 1 : -1;

      // Then sort by priority
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      return aPriority - bPriority;
    });
  }, [filteredTasks, linkedTaskIds]);

  if (!open || !mounted || !position) return null;

  // Determine animation origin based on placement
  const slideClass =
    position.placement === 'left'
      ? 'slide-in-from-right-2'
      : position.placement === 'below'
        ? 'slide-in-from-top-2'
        : 'slide-in-from-left-2';

  const popoverContent = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-label="Select tasks to add"
      className={cn(
        'bg-surface-container fixed z-[60] flex flex-col overflow-hidden rounded-2xl shadow-xl',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        slideClass,
      )}
      style={{
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_HEIGHT,
      }}
    >
      {/* Search header */}
      <div className="border-outline-variant/20 shrink-0 border-b px-3 py-2.5">
        <div className="bg-surface-container-high flex items-center gap-2 rounded-full px-3 py-1.5">
          <SearchOutlined sx={{ fontSize: 16 }} className="text-on-surface-variant shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className={cn(
              'flex-1 bg-transparent text-sm',
              'focus:outline-none',
              'placeholder:text-on-surface-variant/50',
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
              }}
              className="text-on-surface-variant hover:text-on-surface shrink-0"
            >
              <CloseOutlined sx={{ fontSize: 14 }} />
            </button>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <SyncOutlined sx={{ fontSize: 20 }} className="text-on-surface-variant animate-spin" />
          </div>
        ) : sortedTasks.length > 0 ? (
          <div className="space-y-0.5">
            {sortedTasks.map((task) => (
              <SelectableTaskRow
                key={task.id}
                task={task}
                isLinked={linkedTaskIds.includes(task.id)}
                onSelect={async () => onSelect(task.id)}
              />
            ))}
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-on-surface-variant text-sm">
              {searchQuery ? 'No tasks match your search.' : 'No incomplete tasks available.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(popoverContent, document.body);
});

export default TimeBlockTaskSelector;
