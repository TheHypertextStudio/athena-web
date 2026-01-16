/**
 * Time block detail modal component.
 *
 * Allows viewing and editing a time block, including linked tasks.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import DragIndicator from '@mui/icons-material/DragIndicator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TimeBlock, TimeBlockLinkedTask, Task } from '@/lib/api-client';

// =============================================================================
// Constants
// =============================================================================

const TIME_BLOCK_COLORS = [
  { value: '#4285f4', label: 'Blue' },
  { value: '#ea4335', label: 'Red' },
  { value: '#fbbc05', label: 'Yellow' },
  { value: '#34a853', label: 'Green' },
  { value: '#9c27b0', label: 'Purple' },
  { value: '#ff6d00', label: 'Orange' },
  { value: '#00bcd4', label: 'Cyan' },
  { value: '#607d8b', label: 'Gray' },
];

// =============================================================================
// Types
// =============================================================================

export interface TimeBlockDetailModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** The time block to display/edit */
  timeBlock: TimeBlock | null;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback when time block is updated */
  onUpdate: (id: string, data: Partial<TimeBlock>) => Promise<void>;
  /** Callback when time block is deleted */
  onDelete: (id: string) => Promise<void>;
  /** Callback when a task is unlinked */
  onUnlinkTask: (timeBlockId: string, taskId: string) => Promise<void>;
  /** Callback to open task selector with anchor position */
  onAddTaskClick: (anchorRect: DOMRect) => void;
  /** Callback when a linked task is clicked */
  onTaskClick?: (task: TimeBlockLinkedTask) => void;
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

/** Linked task row in the detail modal */
function LinkedTaskRow({
  task,
  onRemove,
  onClick,
}: {
  task: TimeBlockLinkedTask;
  onRemove: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2',
        'bg-surface-container hover:bg-surface-container-high',
        'transition-colors duration-150',
      )}
    >
      <DragIndicator sx={{ fontSize: 16 }} className="text-on-surface-variant/50 cursor-grab" />
      <PriorityDot priority={task.priority} />
      <button
        type="button"
        onClick={onClick}
        className="text-on-surface min-w-0 flex-1 truncate text-left text-sm"
      >
        {task.title}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={cn(
          'text-on-surface-variant hover:text-error shrink-0',
          'rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100',
          'hover:bg-error/10',
        )}
        aria-label={`Remove ${task.title} from time block`}
      >
        <CloseOutlined sx={{ fontSize: 16 }} />
      </button>
    </div>
  );
}

/** Color selection row */
function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TIME_BLOCK_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          onClick={() => {
            onChange(color.value);
          }}
          className={cn(
            'h-8 w-8 rounded-full transition-all duration-150',
            'ring-offset-surface ring-offset-2',
            value === color.value ? 'ring-primary ring-2' : 'hover:scale-110',
          )}
          style={{ backgroundColor: color.value }}
          aria-label={color.label}
          title={color.label}
        />
      ))}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Modal for viewing and editing time block details.
 */
export const TimeBlockDetailModal = memo(function TimeBlockDetailModal({
  open,
  timeBlock,
  onClose,
  onUpdate,
  onDelete,
  onUnlinkTask,
  onAddTaskClick,
  onTaskClick,
}: TimeBlockDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);

  // SSR safety: only render portal after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync form state with time block
  useEffect(() => {
    if (open && timeBlock) {
      setLabel(timeBlock.label);
      setDescription(timeBlock.description ?? '');
      setColor(timeBlock.color);

      // Parse ISO strings to time inputs
      const start = new Date(timeBlock.startTime);
      const end = new Date(timeBlock.endTime);
      setStartTime(
        `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`,
      );
      setEndTime(
        `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`,
      );

      setIsSubmitting(false);
      setIsDeleting(false);

      // Focus input after animation
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open, timeBlock]);

  // Close on escape
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  const handleSave = useCallback(async () => {
    if (!timeBlock || !label.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Build updated time values
      const originalStart = new Date(timeBlock.startTime);
      const originalEnd = new Date(timeBlock.endTime);

      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);

      const newStart = new Date(originalStart);
      newStart.setHours(startHour ?? 0, startMin ?? 0, 0, 0);

      const newEnd = new Date(originalEnd);
      newEnd.setHours(endHour ?? 0, endMin ?? 0, 0, 0);

      await onUpdate(timeBlock.id, {
        label: label.trim(),
        description: description.trim() || null,
        color,
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
      });
      onClose();
    } catch {
      // Error handling - could show toast
    } finally {
      setIsSubmitting(false);
    }
  }, [timeBlock, label, description, color, startTime, endTime, isSubmitting, onUpdate, onClose]);

  const handleDelete = useCallback(async () => {
    if (!timeBlock || isDeleting) return;

    setIsDeleting(true);
    try {
      await onDelete(timeBlock.id);
      onClose();
    } catch {
      // Error handling
    } finally {
      setIsDeleting(false);
    }
  }, [timeBlock, isDeleting, onDelete, onClose]);

  const handleUnlinkTask = useCallback(
    async (taskId: string) => {
      if (!timeBlock) return;
      await onUnlinkTask(timeBlock.id, taskId);
    },
    [timeBlock, onUnlinkTask],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!open || !timeBlock || !mounted) return null;

  const linkedTasks = timeBlock.linkedTasks;

  return createPortal(
    <AnimatePresence>
      {/* Scrim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClick={handleBackdropClick}
        className="bg-scrim/40 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      >
        {/* Modal */}
        <motion.div
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.9, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 24 }}
          transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
          className={cn('bg-surface-container-low w-full max-w-xl rounded-3xl', 'shadow-2xl')}
        >
          {/* Header with color accent */}
          <div
            className="rounded-t-3xl px-6 py-5"
            style={{ backgroundColor: color ? `${color}20` : undefined }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: color ? `${color}30` : 'var(--md-sys-color-primary-container)',
                  }}
                >
                  <ScheduleOutlined
                    sx={{ fontSize: 20 }}
                    style={{ color: color ?? 'var(--md-sys-color-primary)' }}
                  />
                </div>
                <h2 className="text-on-surface text-xl font-semibold">Time Block</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'text-on-surface-variant hover:text-on-surface',
                  'transition-all duration-200',
                  'hover:bg-surface-container-highest/50 rounded-full p-2',
                  'focus-visible:ring-primary/50 focus:outline-none focus-visible:ring-2',
                )}
                aria-label="Close"
              >
                <CloseOutlined sx={{ fontSize: 20 }} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="space-y-5 px-6 py-6">
            {/* Label input */}
            <div>
              <input
                ref={inputRef}
                type="text"
                placeholder="Time block label..."
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
                className={cn(
                  'bg-transparent',
                  'w-full text-xl font-medium tracking-tight',
                  'focus:outline-none',
                  'placeholder:text-on-surface-variant/40',
                )}
              />
            </div>

            {/* Description */}
            <div>
              <textarea
                placeholder="Add description or notes..."
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                rows={2}
                className={cn(
                  'bg-surface-container rounded-2xl',
                  'w-full px-4 py-3 text-sm leading-relaxed',
                  'focus:ring-primary/20 focus:ring-2 focus:outline-none',
                  'transition-all duration-200',
                  'placeholder:text-on-surface-variant/40',
                  'resize-none',
                )}
              />
            </div>

            {/* Time range */}
            <div className="flex items-center gap-3">
              <div className="bg-surface-container flex items-center gap-2 rounded-full px-4 py-2">
                <ScheduleOutlined sx={{ fontSize: 16 }} className="text-on-surface-variant" />
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                  }}
                  className="bg-transparent text-sm focus:outline-none"
                />
              </div>
              <span className="text-on-surface-variant text-sm">to</span>
              <div className="bg-surface-container rounded-full px-4 py-2">
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                  }}
                  className="bg-transparent text-sm focus:outline-none"
                />
              </div>
            </div>

            {/* Color picker */}
            <div>
              <p className="text-on-surface-variant mb-2 text-sm font-medium">Color</p>
              <ColorPicker value={color} onChange={setColor} />
            </div>

            {/* Linked tasks */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-on-surface-variant text-sm font-medium">
                  Tasks ({linkedTasks.length})
                </p>
                <Button
                  variant="text"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    onAddTaskClick(rect);
                  }}
                  className="text-primary h-auto gap-1 rounded-full px-3 py-1 text-sm"
                >
                  <AddOutlined sx={{ fontSize: 16 }} />
                  Add Task
                </Button>
              </div>
              {linkedTasks.length > 0 ? (
                <div className="space-y-2">
                  {linkedTasks.map((task) => (
                    <LinkedTaskRow
                      key={task.id}
                      task={task}
                      onRemove={() => {
                        void handleUnlinkTask(task.id);
                      }}
                      onClick={
                        onTaskClick
                          ? () => {
                              onTaskClick(task);
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-surface-container rounded-2xl px-4 py-6 text-center">
                  <p className="text-on-surface-variant text-sm">
                    No tasks scheduled in this time block.
                  </p>
                  <p className="text-on-surface-variant/60 mt-1 text-xs">
                    Add tasks to focus on during this time.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 pb-6">
            <Button
              variant="text"
              onClick={() => {
                void handleDelete();
              }}
              disabled={isDeleting}
              className="text-error hover:bg-error/10 rounded-full px-4"
            >
              <DeleteOutlined sx={{ fontSize: 16 }} className="mr-2" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
            <div className="flex items-center gap-3">
              <Button variant="text" onClick={onClose} type="button" className="rounded-full px-6">
                Cancel
              </Button>
              <Button
                variant="filled"
                onClick={() => {
                  void handleSave();
                }}
                disabled={!label.trim() || isSubmitting}
                className="rounded-full px-8"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
});

export default TimeBlockDetailModal;
